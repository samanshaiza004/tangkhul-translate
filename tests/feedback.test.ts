import { expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { CONSENT_VERSION } from "../src/consent";
import { createDbClient } from "../src/db";
import { createFeedbackRecorder, FeedbackInputError } from "../src/feedback";
import { feedback, feedbackTags, inferences, QUALITY_TAGS } from "../src/schema";

type Database = ReturnType<typeof createDbClient>["db"];

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const activeModelVersionId = "00000000-0000-4000-8000-000000000002";

async function insertInference(db: Database): Promise<string> {
  const fixtureId = crypto.randomUUID();
  const [inserted] = await db
    .insert(inferences)
    .values({
      sourceRaw: `Tangkhul fixture ${fixtureId}`,
      sourceNormalized: `tangkhul fixture ${fixtureId}`,
      sourceHash: fixtureId,
      normalizationVersion: "test-v1",
      modelOutput: "English fixture output",
      modelVersionId: activeModelVersionId,
      latencyMs: 10,
    })
    .returning({ id: inferences.id });

  if (!inserted) throw new Error("The test inference was not persisted.");
  return inserted.id;
}

async function expectFeedbackError(
  promise: Promise<unknown>,
  code: FeedbackInputError["code"],
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(FeedbackInputError);
    expect((error as FeedbackInputError).code).toBe(code);
    return;
  }

  throw new Error(`Expected FeedbackInputError with code ${code}`);
}

test("rejects a malformed inference id without accessing the database", async () => {
  const recorder = createFeedbackRecorder(undefined as unknown as Database);

  await expectFeedbackError(
    recorder.record({
      inferenceId: "not-a-uuid",
      verdict: "correct",
      consentVersion: CONSENT_VERSION,
    }),
    "invalid_request",
  );
});

test.skipIf(!testDatabaseUrl)("records a correct verdict", async () => {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for this test");
  }

  const { db, client } = createDbClient({ databaseUrl: testDatabaseUrl, nodeEnv: "test" });

  try {
    const inferenceId = await insertInference(db);
    const recorder = createFeedbackRecorder(db);

    await expect(
      recorder.record({ inferenceId, verdict: "correct", consentVersion: CONSENT_VERSION }),
    ).resolves.toEqual({ outcome: "recorded", status: "recorded" });
  } finally {
    await client.end();
  }
});

test.skipIf(!testDatabaseUrl)("records an unclear verdict", async () => {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for this test");
  }

  const { db, client } = createDbClient({ databaseUrl: testDatabaseUrl, nodeEnv: "test" });

  try {
    const inferenceId = await insertInference(db);
    const recorder = createFeedbackRecorder(db);

    await expect(
      recorder.record({ inferenceId, verdict: "unclear", consentVersion: CONSENT_VERSION }),
    ).resolves.toEqual({ outcome: "recorded", status: "recorded" });
  } finally {
    await client.end();
  }
});

test.skipIf(!testDatabaseUrl)("records an incorrect verdict and its tags", async () => {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for this test");
  }

  const { db, client } = createDbClient({ databaseUrl: testDatabaseUrl, nodeEnv: "test" });

  try {
    const inferenceId = await insertInference(db);
    const recorder = createFeedbackRecorder(db);
    const tags = ["wrong_meaning", "missing_information"] as const;

    await expect(
      recorder.record({
        inferenceId,
        verdict: "incorrect",
        proposedTranslation: "A corrected English translation.",
        tags: [...tags],
        consentVersion: CONSENT_VERSION,
      }),
    ).resolves.toEqual({ outcome: "recorded", status: "pending_review" });

    const [storedFeedback] = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.inferenceId, inferenceId))
      .limit(1);
    if (!storedFeedback) throw new Error("The test feedback was not persisted.");

    const storedTags = await db
      .select({ tag: feedbackTags.tag })
      .from(feedbackTags)
      .where(eq(feedbackTags.feedbackId, storedFeedback.id));
    expect(storedTags).toHaveLength(2);
    expect(storedTags.map(({ tag }) => tag).toSorted()).toEqual([...tags].toSorted());
  } finally {
    await client.end();
  }
});

test.skipIf(!testDatabaseUrl)("returns duplicate for a second submission", async () => {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for this test");
  }

  const { db, client } = createDbClient({ databaseUrl: testDatabaseUrl, nodeEnv: "test" });

  try {
    const inferenceId = await insertInference(db);
    const recorder = createFeedbackRecorder(db);

    await recorder.record({ inferenceId, verdict: "correct", consentVersion: CONSENT_VERSION });
    await expect(
      recorder.record({
        inferenceId,
        verdict: "incorrect",
        proposedTranslation: "A second submission.",
        consentVersion: CONSENT_VERSION,
      }),
    ).resolves.toEqual({ outcome: "duplicate" });

    const storedFeedback = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.inferenceId, inferenceId));
    expect(storedFeedback).toHaveLength(1);
  } finally {
    await client.end();
  }
});

test.skipIf(!testDatabaseUrl)("rejects an unknown inference", async () => {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for this test");
  }

  const { db, client } = createDbClient({ databaseUrl: testDatabaseUrl, nodeEnv: "test" });

  try {
    const recorder = createFeedbackRecorder(db);

    await expectFeedbackError(
      recorder.record({
        inferenceId: crypto.randomUUID(),
        verdict: "correct",
        consentVersion: CONSENT_VERSION,
      }),
      "unknown_inference",
    );
  } finally {
    await client.end();
  }
});

test.skipIf(!testDatabaseUrl)("rejects an unknown quality tag", async () => {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for this test");
  }

  const { db, client } = createDbClient({ databaseUrl: testDatabaseUrl, nodeEnv: "test" });

  try {
    const inferenceId = await insertInference(db);
    const recorder = createFeedbackRecorder(db);

    await expectFeedbackError(
      recorder.record({
        inferenceId,
        verdict: "incorrect",
        proposedTranslation: "A corrected English translation.",
        tags: ["not_a_real_tag"],
        consentVersion: CONSENT_VERSION,
      }),
      "invalid_tag",
    );
  } finally {
    await client.end();
  }
});

test.skipIf(!testDatabaseUrl)("rejects a blank correction", async () => {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for this test");
  }

  const { db, client } = createDbClient({ databaseUrl: testDatabaseUrl, nodeEnv: "test" });

  try {
    const inferenceId = await insertInference(db);
    const recorder = createFeedbackRecorder(db);

    await expectFeedbackError(
      recorder.record({
        inferenceId,
        verdict: "incorrect",
        proposedTranslation: "   ",
        consentVersion: CONSENT_VERSION,
      }),
      "missing_correction",
    );
  } finally {
    await client.end();
  }
});

test.skipIf(!testDatabaseUrl)("rejects stale consent", async () => {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for this test");
  }

  const { db, client } = createDbClient({ databaseUrl: testDatabaseUrl, nodeEnv: "test" });

  try {
    const inferenceId = await insertInference(db);
    const recorder = createFeedbackRecorder(db);

    await expectFeedbackError(
      recorder.record({ inferenceId, verdict: "correct", consentVersion: "contribution-v0" }),
      "stale_consent",
    );
  } finally {
    await client.end();
  }
});

test.skipIf(!testDatabaseUrl)("rejects correction fields for a correct verdict", async () => {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for this test");
  }

  const { db, client } = createDbClient({ databaseUrl: testDatabaseUrl, nodeEnv: "test" });

  try {
    const inferenceId = await insertInference(db);
    const recorder = createFeedbackRecorder(db);

    await expectFeedbackError(
      recorder.record({
        inferenceId,
        verdict: "correct",
        proposedTranslation: "Unexpected correction.",
        consentVersion: CONSENT_VERSION,
      }),
      "invalid_request",
    );
  } finally {
    await client.end();
  }
});

test.skipIf(!testDatabaseUrl)("rejects more than eight distinct tags", async () => {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for this test");
  }

  const { db, client } = createDbClient({ databaseUrl: testDatabaseUrl, nodeEnv: "test" });

  try {
    const inferenceId = await insertInference(db);
    const recorder = createFeedbackRecorder(db);

    await expectFeedbackError(
      recorder.record({
        inferenceId,
        verdict: "incorrect",
        proposedTranslation: "A corrected English translation.",
        tags: [...QUALITY_TAGS, "not_a_ninth_quality_tag"],
        consentVersion: CONSENT_VERSION,
      }),
      "invalid_tag",
    );
  } finally {
    await client.end();
  }
});

test.skipIf(!testDatabaseUrl)("deduplicates repeated tags before enforcing the cap", async () => {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for this test");
  }

  const { db, client } = createDbClient({ databaseUrl: testDatabaseUrl, nodeEnv: "test" });

  try {
    const inferenceId = await insertInference(db);
    const recorder = createFeedbackRecorder(db);

    await expect(
      recorder.record({
        inferenceId,
        verdict: "incorrect",
        proposedTranslation: "A corrected English translation.",
        tags: Array.from({ length: 10 }, () => "wrong_meaning"),
        consentVersion: CONSENT_VERSION,
      }),
    ).resolves.toEqual({ outcome: "recorded", status: "pending_review" });

    const [storedFeedback] = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.inferenceId, inferenceId))
      .limit(1);
    if (!storedFeedback) throw new Error("The test feedback was not persisted.");

    const storedTags = await db
      .select({ tag: feedbackTags.tag })
      .from(feedbackTags)
      .where(eq(feedbackTags.feedbackId, storedFeedback.id));
    expect(storedTags).toHaveLength(1);
    expect(storedTags[0]?.tag).toBe("wrong_meaning");
  } finally {
    await client.end();
  }
});
