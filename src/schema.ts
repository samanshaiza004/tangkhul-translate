import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const feedbackVerdictEnum = pgEnum("feedback_verdict", ["correct", "incorrect", "unclear"]);

export const feedbackStatusEnum = pgEnum("feedback_status", [
  "recorded",
  "pending_review",
  "accepted",
  "rejected",
  "invalid_source",
]);

export const reviewDecisionEnum = pgEnum("review_decision", [
  "accept",
  "edit_accept",
  "reject",
  "invalid_source",
]);

export const reviewSeverityEnum = pgEnum("review_severity", ["minor", "major", "critical"]);

export const legacyVerificationStatusEnum = pgEnum("legacy_verification_status", [
  "unverified",
  "review_required",
]);

export const QUALITY_TAGS = [
  "wrong_meaning",
  "missing_information",
  "added_information",
  "wrong_tense_person_number",
  "name_number_spelling",
  "unnatural_english",
  "source_unclear",
  "other",
] as const;

export type QualityTag = (typeof QUALITY_TAGS)[number];

export const modelVersions = pgTable(
  "model_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    modelRepository: text("model_repository").notNull(),
    modelRevision: text("model_revision").notNull(),
    spaceRepository: text("space_repository").notNull(),
    spaceRevision: text("space_revision").notNull(),
    promptVersion: text("prompt_version").notNull(),
    promptTemplate: text("prompt_template").notNull(),
    generationConfig: jsonb("generation_config").notNull(),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("model_versions_natural_key").on(
      table.modelRepository,
      table.modelRevision,
      table.spaceRepository,
      table.spaceRevision,
      table.promptVersion,
    ),
    uniqueIndex("model_versions_single_active_idx")
      .on(table.active)
      .where(sql`${table.active}`),
  ],
);

export const inferences = pgTable(
  "inferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceRaw: text("source_raw").notNull(),
    sourceNormalized: text("source_normalized").notNull(),
    sourceHash: text("source_hash").notNull(),
    normalizationVersion: text("normalization_version").notNull(),
    modelOutput: text("model_output").notNull(),
    modelVersionId: uuid("model_version_id")
      .notNull()
      .references(() => modelVersions.id, { onDelete: "restrict" }),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inferences_source_hash_idx").on(table.sourceHash),
    index("inferences_model_version_created_idx").on(table.modelVersionId, table.createdAt),
  ],
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    inferenceId: uuid("inference_id")
      .notNull()
      .references(() => inferences.id, { onDelete: "restrict" }),
    verdict: feedbackVerdictEnum("verdict").notNull(),
    proposedTranslation: text("proposed_translation"),
    contributorNote: text("contributor_note"),
    consentVersion: text("consent_version").notNull(),
    status: feedbackStatusEnum("status").notNull().default("recorded"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    unique("feedback_inference_id_key").on(table.inferenceId),
    index("feedback_status_created_idx").on(table.status, table.createdAt),
    check(
      "feedback_proposed_when_incorrect",
      sql`${table.verdict} <> 'incorrect' OR (${table.proposedTranslation} IS NOT NULL AND length(btrim(${table.proposedTranslation})) > 0)`,
    ),
  ],
);

export const feedbackTags = pgTable(
  "feedback_tags",
  {
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    tag: text("tag").notNull().$type<QualityTag>(),
  },
  (table) => [
    primaryKey({ columns: [table.feedbackId, table.tag] }),
    check(
      "feedback_tags_tag_check",
      sql`${table.tag} in (${sql.raw(QUALITY_TAGS.map((tag) => `'${tag}'`).join(", "))})`,
    ),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "restrict" }),
    reviewerRef: text("reviewer_ref").notNull(),
    decision: reviewDecisionEnum("decision").notNull(),
    finalTranslation: text("final_translation"),
    domain: text("domain"),
    severity: reviewSeverityEnum("severity"),
    reviewerNote: text("reviewer_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("reviews_feedback_created_idx").on(table.feedbackId, table.createdAt),
    check(
      "reviews_final_when_accepted",
      sql`${table.decision} NOT IN ('accept','edit_accept') OR (${table.finalTranslation} IS NOT NULL AND length(btrim(${table.finalTranslation})) > 0)`,
    ),
  ],
);

export const reviewTags = pgTable(
  "review_tags",
  {
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    tag: text("tag").notNull().$type<QualityTag>(),
  },
  (table) => [
    primaryKey({ columns: [table.reviewId, table.tag] }),
    check(
      "review_tags_tag_check",
      sql`${table.tag} in (${sql.raw(QUALITY_TAGS.map((tag) => `'${tag}'`).join(", "))})`,
    ),
  ],
);

export const datasetExports = pgTable("dataset_exports", {
  id: uuid("id").defaultRandom().primaryKey(),
  version: text("version").notNull().unique(),
  reviewerRef: text("reviewer_ref").notNull(),
  selectionRules: jsonb("selection_rules").notNull(),
  recordCount: integer("record_count").notNull(),
  manifest: jsonb("manifest").notNull(),
  checksum: text("checksum").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const legacyRecords = pgTable(
  "legacy_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    rowFingerprint: text("row_fingerprint").notNull().unique(),
    sourceRaw: text("source_raw").notNull(),
    correction: text("correction"),
    provenance: text("provenance").notNull().default("legacy_google_sheet"),
    consentVersion: text("consent_version").notNull().default("legacy_or_unknown"),
    verificationStatus: legacyVerificationStatusEnum("verification_status")
      .notNull()
      .default("unverified"),
    sourceRowNumber: integer("source_row_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("legacy_records_status_created_idx").on(table.verificationStatus, table.createdAt),
    check("legacy_records_provenance_check", sql`${table.provenance} = 'legacy_google_sheet'`),
    check("legacy_records_consent_check", sql`${table.consentVersion} = 'legacy_or_unknown'`),
  ],
);
