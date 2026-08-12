import { eq } from "drizzle-orm";

import type { createDbClient } from "./db";
import { CONSENT_VERSION } from "./consent";
import { feedback, feedbackTags, inferences, QUALITY_TAGS } from "./schema";
import type { QualityTag } from "./schema";

type Database = ReturnType<typeof createDbClient>["db"];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FeedbackInputErrorCode =
  | "invalid_request"
  | "invalid_verdict"
  | "stale_consent"
  | "invalid_tag"
  | "missing_correction"
  | "unknown_inference";

export class FeedbackInputError extends Error {
  constructor(
    readonly code: FeedbackInputErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FeedbackInputError";
  }
}

export type FeedbackVerdict = "correct" | "incorrect" | "unclear";

export interface FeedbackSubmission {
  inferenceId: string;
  verdict: string;
  proposedTranslation?: string;
  contributorNote?: string;
  tags?: string[];
  consentVersion: string;
}

export type FeedbackOutcome =
  | { outcome: "recorded"; status: "recorded" | "pending_review" }
  | { outcome: "duplicate" };

export interface FeedbackRecorder {
  record(submission: FeedbackSubmission): Promise<FeedbackOutcome>;
}

export function createFeedbackRecorder(db: Database): FeedbackRecorder {
  return {
    async record(submission) {
      if (!UUID_PATTERN.test(submission.inferenceId)) {
        throw new FeedbackInputError("invalid_request", "This translation could not be found.");
      }

      if (submission.consentVersion !== CONSENT_VERSION) {
        throw new FeedbackInputError(
          "stale_consent",
          "Terms changed — reload the page and try again.",
        );
      }

      if (
        submission.verdict !== "correct" &&
        submission.verdict !== "incorrect" &&
        submission.verdict !== "unclear"
      ) {
        throw new FeedbackInputError(
          "invalid_verdict",
          "Choose whether the translation looks correct, is unclear, or needs a correction.",
        );
      }

      let dedupedTags: QualityTag[] = [];

      if (submission.verdict === "incorrect") {
        const proposedTranslation = submission.proposedTranslation?.trim();
        if (!proposedTranslation) {
          throw new FeedbackInputError(
            "missing_correction",
            "Enter the corrected English translation.",
          );
        }
        if (proposedTranslation.length > 8000) {
          throw new FeedbackInputError(
            "missing_correction",
            "The correction is too long. Shorten it and try again.",
          );
        }

        if ((submission.contributorNote?.trim().length ?? 0) > 2000) {
          throw new FeedbackInputError(
            "invalid_request",
            "The note is too long. Shorten it and try again.",
          );
        }

        if (submission.tags !== undefined) {
          if (!Array.isArray(submission.tags)) {
            throw new FeedbackInputError(
              "invalid_tag",
              "One of the selected issue tags isn't recognized.",
            );
          }

          const distinctTags = [...new Set(submission.tags)];
          if (distinctTags.length > 8) {
            throw new FeedbackInputError("invalid_tag", "Choose at most 8 issue tags.");
          }
          if (distinctTags.some((tag) => !QUALITY_TAGS.includes(tag as QualityTag))) {
            throw new FeedbackInputError(
              "invalid_tag",
              "One of the selected issue tags isn't recognized.",
            );
          }
          dedupedTags = distinctTags as QualityTag[];
        }
      } else {
        const hasProposedTranslation =
          submission.proposedTranslation !== undefined &&
          submission.proposedTranslation.trim().length > 0;
        const hasContributorNote =
          submission.contributorNote !== undefined && submission.contributorNote.trim().length > 0;
        const hasTags = Array.isArray(submission.tags) && submission.tags.length > 0;

        if (hasProposedTranslation || hasContributorNote || hasTags) {
          throw new FeedbackInputError("invalid_request", "Unexpected fields for this verdict.");
        }
      }

      const matchingInferences = await db
        .select({ id: inferences.id })
        .from(inferences)
        .where(eq(inferences.id, submission.inferenceId))
        .limit(1);

      if (matchingInferences.length === 0) {
        throw new FeedbackInputError("unknown_inference", "This translation could not be found.");
      }

      const status: "recorded" | "pending_review" =
        submission.verdict === "incorrect" ? "pending_review" : "recorded";

      return db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(feedback)
          .values({
            inferenceId: submission.inferenceId,
            verdict: submission.verdict as FeedbackVerdict,
            proposedTranslation:
              submission.verdict === "incorrect" ? submission.proposedTranslation : undefined,
            contributorNote: submission.contributorNote,
            consentVersion: CONSENT_VERSION,
            status,
          })
          .onConflictDoNothing({ target: feedback.inferenceId })
          .returning({ id: feedback.id });

        if (!inserted) {
          return { outcome: "duplicate" as const };
        }

        if (dedupedTags.length > 0) {
          await tx
            .insert(feedbackTags)
            .values(dedupedTags.map((tag) => ({ feedbackId: inserted.id, tag })));
        }

        return { outcome: "recorded" as const, status };
      });
    },
  };
}
