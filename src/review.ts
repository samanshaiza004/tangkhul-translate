import { and, asc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import type { createDbClient } from "./db";
import type { QualityTag } from "./schema";
import { feedback, feedbackTags, inferences, reviewTags, reviews } from "./schema";

type Database = ReturnType<typeof createDbClient>["db"];

export type ReviewDecision = "accept" | "edit_accept" | "reject" | "invalid_source";
export type ReviewSeverity = "minor" | "major" | "critical";

export interface ReviewQueueItem {
  feedbackId: string;
  inferenceId: string;
  sourceRaw: string;
  sourceNormalized: string;
  sourceHash: string;
  modelOutput: string;
  proposedTranslation: string;
  contributorNote: string | null;
  consentVersion: string;
  createdAt: Date;
  tags: QualityTag[];
  exactSourceMatches: Array<{ feedbackId: string; sourceRaw: string; modelOutput: string }>;
  normalizedTargetMatches: Array<{
    feedbackId: string;
    sourceRaw: string;
    target: string;
    status: string;
  }>;
  priorAcceptedTargets: string[];
  competingCorrections: Array<{ feedbackId: string; target: string }>;
}

export interface ReviewSubmission {
  feedbackId: string;
  reviewerRef: string;
  decision: ReviewDecision;
  finalTranslation?: string;
  domain?: string;
  severity?: ReviewSeverity;
  reviewerNote?: string;
  tags?: QualityTag[];
}

export type ReviewOutcome =
  | { outcome: "recorded"; status: "accepted" | "rejected" | "invalid_source"; reviewId: string }
  | { outcome: "conflict"; currentStatus: string };

export async function loadNextPending(db: Database): Promise<ReviewQueueItem | undefined> {
  const rows = await db
    .select({
      feedbackId: feedback.id,
      inferenceId: inferences.id,
      sourceRaw: inferences.sourceRaw,
      sourceNormalized: inferences.sourceNormalized,
      sourceHash: inferences.sourceHash,
      modelOutput: inferences.modelOutput,
      proposedTranslation: feedback.proposedTranslation,
      contributorNote: feedback.contributorNote,
      consentVersion: feedback.consentVersion,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    .innerJoin(inferences, eq(inferences.id, feedback.inferenceId))
    .where(eq(feedback.status, "pending_review"))
    .orderBy(asc(feedback.createdAt), asc(feedback.id))
    .limit(1);

  const row = rows[0];
  if (!row || row.proposedTranslation === null) return undefined;

  const tags = await db
    .select({ tag: feedbackTags.tag })
    .from(feedbackTags)
    .where(eq(feedbackTags.feedbackId, row.feedbackId))
    .orderBy(asc(feedbackTags.tag));

  const exactSourceMatches = await db.execute<{
    feedback_id: string;
    source_raw: string;
    model_output: string;
  }>(sql`
    select f.id as feedback_id, i.source_raw, i.model_output
    from feedback f
    join inferences i on i.id = f.inference_id
    where i.source_hash = ${row.sourceHash}
      and f.id <> ${row.feedbackId}
    order by f.created_at asc, f.id asc
  `);

  const normalizedTargetMatches = await db.execute<{
    feedback_id: string;
    source_raw: string;
    target: string;
    status: string;
  }>(sql`
    select f.id as feedback_id, i.source_raw,
      coalesce(r.final_translation, f.proposed_translation) as target,
      f.status
    from feedback f
    join inferences i on i.id = f.inference_id
    left join lateral (
      select final_translation
      from reviews
      where feedback_id = f.id and decision in ('accept', 'edit_accept')
      order by created_at desc, id desc
      limit 1
    ) r on true
    where i.source_normalized = ${row.sourceNormalized}
      and f.id <> ${row.feedbackId}
      and coalesce(r.final_translation, f.proposed_translation) is not null
    order by f.created_at asc, f.id asc
  `);

  const priorAcceptedTargets = normalizedTargetMatches
    .filter((match) => match.status === "accepted")
    .map((match) => match.target);
  const competingCorrections = normalizedTargetMatches
    .filter((match) => match.status === "pending_review")
    .map((match) => ({ feedbackId: match.feedback_id, target: match.target }));

  return {
    ...row,
    proposedTranslation: row.proposedTranslation,
    tags: tags.map(({ tag }) => tag),
    exactSourceMatches: exactSourceMatches.map((match) => ({
      feedbackId: match.feedback_id,
      sourceRaw: match.source_raw,
      modelOutput: match.model_output,
    })),
    normalizedTargetMatches: normalizedTargetMatches.map((match) => ({
      feedbackId: match.feedback_id,
      sourceRaw: match.source_raw,
      target: match.target,
      status: match.status,
    })),
    priorAcceptedTargets,
    competingCorrections,
  };
}

export async function recordReview(
  db: Database,
  submission: ReviewSubmission,
): Promise<ReviewOutcome> {
  if (["accept", "edit_accept"].includes(submission.decision)) {
    if (!submission.finalTranslation?.trim()) {
      throw new Error("Accepted reviews require a non-empty final translation.");
    }
  }

  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ status: string }>(sql`
      select status
      from feedback
      where id = ${submission.feedbackId}
      for update
    `);
    const currentStatus = locked[0]?.status;
    if (currentStatus !== "pending_review") {
      return { outcome: "conflict", currentStatus: currentStatus ?? "missing" };
    }

    const [review] = await tx
      .insert(reviews)
      .values({
        feedbackId: submission.feedbackId,
        reviewerRef: submission.reviewerRef,
        decision: submission.decision,
        finalTranslation: submission.finalTranslation,
        domain: submission.domain,
        severity: submission.severity,
        reviewerNote: submission.reviewerNote,
      })
      .returning({ id: reviews.id });
    if (!review) throw new Error("Review was not inserted.");

    if (submission.tags && submission.tags.length > 0) {
      await tx
        .insert(reviewTags)
        .values([...new Set(submission.tags)].map((tag) => ({ reviewId: review.id, tag })));
    }

    const status =
      submission.decision === "accept" || submission.decision === "edit_accept"
        ? "accepted"
        : submission.decision === "reject"
          ? "rejected"
          : "invalid_source";
    await tx
      .update(feedback)
      .set({ status, reviewedAt: new Date() })
      .where(and(eq(feedback.id, submission.feedbackId), eq(feedback.status, "pending_review")));

    return { outcome: "recorded", status, reviewId: review.id };
  });
}
