/* oxlint-disable no-await-in-loop */

import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { eq } from "drizzle-orm";

import { createDbClient } from "../src/db";
import { createFeedbackRecorder } from "../src/feedback";
import { sourceHash } from "../src/normalization";
import { recordReview } from "../src/review";
import { feedback, inferences, modelVersions } from "../src/schema";
import { CONSENT_VERSION } from "../src/consent";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const root = resolve(import.meta.dir, "..");

async function run(command: string[], env: Record<string, string | undefined>) {
  const child = Bun.spawn(command, { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

test.skipIf(!testDatabaseUrl)("rehearses review through an immutable dataset export", async () => {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required for this test");

  const version = `integration-${crypto.randomUUID()}`;
  const outputDir = resolve(root, "exports", version);
  const exclusionPath = resolve(root, "data/benchmark-exclusions/v1.txt");
  const env = {
    ...Bun.env,
    DATABASE_URL: testDatabaseUrl,
    NODE_ENV: "test",
    REVIEWER_ID: "integration-reviewer",
  };
  const { db, client } = createDbClient({ databaseUrl: testDatabaseUrl, nodeEnv: "test" });
  const inferenceIds: string[] = [];
  const feedbackIds: string[] = [];
  const originalExclusions = await readFile(exclusionPath);

  try {
    const migration = await run(["bun", "run", "db:migrate"], env);
    expect(migration.code).toBe(0);

    const [active] = await db
      .select({ id: modelVersions.id })
      .from(modelVersions)
      .where(eq(modelVersions.active, true))
      .limit(1);
    if (!active) throw new Error("The disposable database has no active model version.");

    const recorder = createFeedbackRecorder(db);
    const candidates = [
      {
        sourceRaw: "Āthum rāra.",
        modelOutput: "Those two will come.",
        correction: "Those two are coming.",
      },
      {
        sourceRaw: "Na kali leili?",
        modelOutput: "Where are you?",
        correction: "Where are you located?",
      },
    ];
    for (const candidate of candidates) {
      const [inference] = await db
        .insert(inferences)
        .values({
          sourceRaw: candidate.sourceRaw,
          sourceNormalized: candidate.sourceRaw,
          sourceHash: sourceHash(candidate.sourceRaw),
          normalizationVersion: "n1",
          modelOutput: candidate.modelOutput,
          modelVersionId: active.id,
          latencyMs: 1,
        })
        .returning({ id: inferences.id });
      if (!inference) throw new Error("The test inference was not persisted.");
      inferenceIds.push(inference.id);

      const feedbackResult = await recorder.record({
        inferenceId: inference.id,
        verdict: "incorrect",
        proposedTranslation: candidate.correction,
        consentVersion: CONSENT_VERSION,
      });
      expect(feedbackResult).toEqual({ outcome: "recorded", status: "pending_review" });

      const [storedFeedback] = await db
        .select({ id: feedback.id })
        .from(feedback)
        .where(eq(feedback.inferenceId, inference.id));
      if (!storedFeedback) throw new Error("The test feedback was not persisted.");
      feedbackIds.push(storedFeedback.id);

      await expect(
        recordReview(db, {
          feedbackId: storedFeedback.id,
          reviewerRef: "integration-reviewer",
          decision: "accept",
          finalTranslation: candidate.correction,
          tags: ["wrong_meaning"],
        }),
      ).resolves.toMatchObject({ outcome: "recorded", status: "accepted" });
    }

    await writeFile(exclusionPath, `${sourceHash(candidates[0]!.sourceRaw)}\n`);

    const first = await run(
      ["bun", "run", "dataset:export", "--version", version, "--allow-dirty"],
      env,
    );
    expect(first.code).toBe(0);

    const jsonl = await readFile(resolve(outputDir, "accepted.jsonl"), "utf8");
    const manifest = JSON.parse(await readFile(resolve(outputDir, "manifest.json"), "utf8")) as {
      record_count: number;
      jsonl_sha256: string;
    };
    const checksums = await readFile(resolve(outputDir, "checksums.txt"), "utf8");
    expect(jsonl).toContain('"target":"Those two are coming."');
    expect(manifest.record_count).toBe(1);
    expect(jsonl).not.toContain('"source":"Āthum rāra."');
    expect(jsonl).toContain('"source":"Na kali leili?"');
    expect(manifest).toMatchObject({
      benchmark_exclusions: {
        version: "v1",
        path: "data/benchmark-exclusions/v1.txt",
        count: 1,
        removed_count: 1,
      },
    });
    expect(checksums).toContain(`${manifest.jsonl_sha256}  accepted.jsonl`);

    const exported =
      await client`select version, record_count from dataset_exports where version = ${version}`;
    expect(exported).toHaveLength(1);
    expect(exported[0]?.version).toBe(version);
    expect(exported[0]?.record_count).toBe(1);

    const second = await run(
      ["bun", "run", "dataset:export", "--version", version, "--allow-dirty"],
      env,
    );
    expect(second.code).not.toBe(0);
    expect(`${second.stdout}\n${second.stderr}`).toContain("Export directory already exists");
  } finally {
    await writeFile(exclusionPath, originalExclusions);
    await rm(outputDir, { recursive: true, force: true });
    for (const feedbackId of feedbackIds) {
      await client`delete from reviews where feedback_id = ${feedbackId}`;
      await client`delete from feedback where id = ${feedbackId}`;
    }
    for (const inferenceId of inferenceIds) {
      await client`delete from inferences where id = ${inferenceId}`;
    }
    await client.end();
  }
});
