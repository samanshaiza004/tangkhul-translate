import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONSENT_VERSION } from "../src/consent";
import { postgresOptions } from "../src/db";
import { normalizeTargetForDedup, readExclusionList } from "../src/export";
import { recordReview } from "../src/review";

describe("review and export invariants", () => {
  test("uses the exact target dedup normalization without lowercasing", () => {
    expect(normalizeTargetForDedup("  A\r\nB  ")).toBe("A\nB");
    expect(normalizeTargetForDedup("É")).toBe(normalizeTargetForDedup("E\u0301"));
    expect(normalizeTargetForDedup("A")).not.toBe("a");
  });

  test("validates a sorted unique benchmark exclusion list", async () => {
    const root = await mkdtemp(join(tmpdir(), "tangkhul-export-"));
    try {
      await mkdir(join(root, "data/benchmark-exclusions"), { recursive: true });
      await writeFile(
        join(root, "data/benchmark-exclusions/v1.txt"),
        `${"0".repeat(64)}\n${"f".repeat(64)}\n`,
      );
      const exclusions = await readExclusionList(root);
      expect(exclusions.version).toBe("v1");
      expect(exclusions.hashes.size).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects accepted review without a final translation before touching the database", async () => {
    await expect(
      recordReview(undefined as never, {
        feedbackId: crypto.randomUUID(),
        reviewerRef: "saman",
        decision: "accept",
        finalTranslation: "   ",
      }),
    ).rejects.toThrow("non-empty final translation");
  });

  test("keeps consent version as an explicit export invariant", () => {
    expect(CONSENT_VERSION).toBe("contribution-v1");
  });

  test("shares URL-driven SSL behavior with the exporter", () => {
    expect(
      postgresOptions("postgresql://localhost/postgres?sslmode=disable", "test").ssl,
    ).toBeFalse();
    expect(postgresOptions("postgresql://db.example/postgres", "production").ssl).toBe("require");
  });
});
