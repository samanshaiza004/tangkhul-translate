/* oxlint-disable no-await-in-loop */

import { createDbClient } from "../src/db";
import { loadNextPending, recordReview } from "../src/review";
import type { QualityTag } from "../src/schema";
import { parseEnv } from "../src/config";

const config = parseEnv(Bun.env);
const reviewerRef = Bun.env.REVIEWER_ID?.trim();
if (!reviewerRef) {
  console.error("REVIEWER_ID is required, for example: REVIEWER_ID=saman bun run review");
  process.exit(1);
}

const { db, client } = createDbClient({ databaseUrl: config.databaseUrl, nodeEnv: "development" });
const reader = Bun.stdin.stream().getReader();

async function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    if (new TextDecoder().decode(value).includes("\n")) break;
  }
  return new TextDecoder().decode(concat(chunks)).trimEnd();
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function printItem(item: Awaited<ReturnType<typeof loadNextPending>>): void {
  if (!item) return;
  console.log(`\nReviewer: ${reviewerRef}`);
  console.log(`Feedback: ${item.feedbackId}`);
  console.log(`Source: ${item.sourceRaw}`);
  console.log(`Normalized: ${item.sourceNormalized}`);
  console.log(`Source hash: ${item.sourceHash}`);
  console.log(`Model output: ${item.modelOutput}`);
  console.log(`Contributor correction: ${item.proposedTranslation}`);
  console.log(`Tags: ${item.tags.join(", ") || "(none)"}`);
  console.log(`Note: ${item.contributorNote || "(none)"}`);
  console.log(`Consent: ${item.consentVersion}`);
  console.log(`Exact source matches: ${item.exactSourceMatches.length}`);
  for (const match of item.exactSourceMatches) {
    console.log(`  - ${match.feedbackId}: ${match.sourceRaw} -> ${match.modelOutput}`);
  }
  console.log(`Normalized source-target matches: ${item.normalizedTargetMatches.length}`);
  for (const match of item.normalizedTargetMatches) {
    console.log(`  - ${match.feedbackId} [${match.status}]: ${match.target}`);
  }
  console.log(`Prior accepted targets: ${item.priorAcceptedTargets.join(" | ") || "(none)"}`);
  console.log(`Competing corrections: ${item.competingCorrections.length}`);
}

try {
  console.log(`Reviewer: ${reviewerRef}`);
  while (true) {
    const item = await loadNextPending(db);
    if (!item) {
      console.log("No pending corrections.");
      break;
    }
    printItem(item);
    const action = (await ask("\n[a]ccept [e]dit [r]eject [i]nvalid [s]kip [q]uit: "))
      .trim()
      .toLowerCase();
    if (action === "q") break;
    if (action === "s" || action === "") continue;
    if (!["a", "e", "r", "i"].includes(action)) {
      console.log("Unknown action.");
      continue;
    }

    let finalTranslation: string | undefined;
    let decision: "accept" | "edit_accept" | "reject" | "invalid_source";
    if (action === "a") {
      decision = "accept";
      finalTranslation = item.proposedTranslation;
    } else if (action === "e") {
      decision = "edit_accept";
      finalTranslation = (await ask(`Final translation [${item.proposedTranslation}]: `)).trim();
      if (!finalTranslation) {
        console.log("Edit cancelled: final translation cannot be blank.");
        continue;
      }
    } else {
      decision = action === "r" ? "reject" : "invalid_source";
    }

    const domain = await ask("Domain (optional): ");
    const severityInput = (await ask("Severity [minor|major|critical] (optional): ")).trim();
    const severity = ["minor", "major", "critical"].includes(severityInput)
      ? (severityInput as "minor" | "major" | "critical")
      : undefined;
    const reviewTagsInput = await ask("Review tags, comma-separated (optional): ");
    const reviewTags = reviewTagsInput
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag): tag is QualityTag => item.tags.includes(tag as QualityTag));
    const reviewerNote = await ask("Reviewer note (optional): ");
    const result = await recordReview(db, {
      feedbackId: item.feedbackId,
      reviewerRef,
      decision,
      finalTranslation,
      domain: domain || undefined,
      severity,
      reviewerNote: reviewerNote || undefined,
      tags: reviewTags,
    });
    if (result.outcome === "conflict") {
      console.log(`Review not recorded; current status is ${result.currentStatus}.`);
    } else {
      console.log(`Recorded ${decision} (${result.reviewId}).`);
    }
  }
} finally {
  reader.releaseLock();
  await client.end();
}
