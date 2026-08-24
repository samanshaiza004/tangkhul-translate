import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const BENCHMARK_EXCLUSION_PATH = "data/benchmark-exclusions/v1.txt";

export function normalizeTargetForDedup(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

export interface ExclusionList {
  version: string;
  path: string;
  sha256: string;
  hashes: Set<string>;
}

export async function readExclusionList(root: string): Promise<ExclusionList> {
  const path = join(root, BENCHMARK_EXCLUSION_PATH);
  const bytes = await readFile(path);
  const text = bytes.toString("utf8");
  if (!text.endsWith("\n")) throw new Error("Benchmark exclusion file must be newline-terminated.");
  const lines = text === "\n" ? [] : text.split("\n").slice(0, -1);
  if (lines.some((line) => !/^[0-9a-f]{64}$/.test(line))) {
    throw new Error("Benchmark exclusion file contains an invalid SHA-256 hash.");
  }
  const sorted = [...lines].toSorted();
  if (JSON.stringify(lines) !== JSON.stringify(sorted)) {
    throw new Error("Benchmark exclusion file must be sorted.");
  }
  if (new Set(lines).size !== lines.length) {
    throw new Error("Benchmark exclusion file must not contain duplicate hashes.");
  }
  return {
    version: "v1",
    path: BENCHMARK_EXCLUSION_PATH,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    hashes: new Set(lines),
  };
}
