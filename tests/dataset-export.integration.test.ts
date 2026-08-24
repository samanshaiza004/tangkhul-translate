import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { eq } from "drizzle-orm";

import { createDbClient } from "../src/db";
import { createFeedbackRecorder } from "../src/feedback";
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
  const env = {
    ...Bun.env,
    DATABASE_URL: testDatabaseUrl,
    NODE_ENV: "test",
    REVIEWER_ID: "integration-reviewer",
  };
  const { db, client } = createDbClient({ databaseUrl: testDatabaseUrl, nodeEnv: "test" });
  let inferenceId: string | undefined;
  let feedbackId: string | undefined;

  try {
    const migration = await run(["bun", "run", "db:migrate"], env);
    expect(migration.code).toBe(0);

    const [active] = await db
      .select({ id: modelVersions.id })
      .from(modelVersions)
      .where(eq(modelVersions.active, true))
      .limit(1);
    if (!active) throw new Error("The disposable database has no active model version.");

    const [inference] = await db
      .insert(inferences)
      .values({
        sourceRaw: "Āthum rāra.",
        sourceNormalized: "Āthum rāra.",
        sourceHash: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"),
        normalizationVersion: "test-v1",
        modelOutput: "Those two will come.",
        modelVersionId: active.id,
        latencyMs: 1,
      })
      .returning({ id: inferences.id });
    if (!inference) throw new Error("The test inference was not persisted.");
    inferenceId = inference.id;

    const recorder = createFeedbackRecorder(db);
    const feedbackResult = await recorder.record({
      inferenceId,
      verdict: "incorrect",
      proposedTranslation: "Those two are coming.",
      consentVersion: CONSENT_VERSION,
    });
    expect(feedbackResult).toEqual({ outcome: "recorded", status: "pending_review" });

    const [storedFeedback] = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.inferenceId, inferenceId));
    if (!storedFeedback) throw new Error("The test feedback was not persisted.");
    feedbackId = storedFeedback.id;

    await expect(
      recordReview(db, {
        feedbackId,
        reviewerRef: "integration-reviewer",
        decision: "accept",
        finalTranslation: "Those two are coming.",
        tags: ["wrong_meaning"],
      }),
    ).resolves.toMatchObject({ outcome: "recorded", status: "accepted" });

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
    await rm(outputDir, { recursive: true, force: true });
    if (feedbackId) {
      await client`delete from reviews where feedback_id = ${feedbackId}`;
      await client`delete from feedback where id = ${feedbackId}`;
    }
    if (inferenceId) await client`delete from inferences where id = ${inferenceId}`;
    await client.end();
  }
});
