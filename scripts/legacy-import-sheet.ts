/* oxlint-disable no-await-in-loop */

import { readFile } from "node:fs/promises";

import { parseEnv } from "../src/config";
import { createDbClient } from "../src/db";
import { legacyRowFingerprint, parseLegacyCsv } from "../src/legacy";
import { legacyRecords } from "../src/schema";

const csvPath = Bun.argv[2];
if (!csvPath) {
  console.error("Usage: bun run legacy:import-sheet <csv>");
  process.exit(1);
}

const SOURCE_HEADERS = new Set(["source", "tangkhul", "tangkhul_text", "input"]);
const CORRECTION_HEADERS = new Set([
  "correction",
  "translation",
  "english",
  "proposed_translation",
  "target",
]);

function normalizedHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

const config = parseEnv(Bun.env);
const input = await readFile(csvPath, "utf8");
const rows = parseLegacyCsv(input);
const header = rows.shift();
if (!header) throw new Error("Legacy CSV is empty.");

const headers = header.values.map(normalizedHeader);
const sourceIndex = headers.findIndex((value) => SOURCE_HEADERS.has(value));
const correctionIndex = headers.findIndex((value) => CORRECTION_HEADERS.has(value));
if (sourceIndex < 0) {
  throw new Error("Legacy CSV must contain a source column (source or tangkhul). ");
}

const { db, client } = createDbClient({ databaseUrl: config.databaseUrl, nodeEnv: "development" });
let imported = 0;
let duplicates = 0;
let invalid = 0;
let skipped = 0;

try {
  for (const row of rows) {
    const sourceRaw = row.values[sourceIndex];
    if (sourceRaw === undefined || sourceRaw.length === 0) {
      invalid += 1;
      continue;
    }

    const correction = correctionIndex < 0 ? null : (row.values[correctionIndex] ?? null);
    const rowFingerprint = legacyRowFingerprint(sourceRaw, correction);
    const inserted = await db
      .insert(legacyRecords)
      .values({
        rowFingerprint,
        sourceRaw,
        correction,
        sourceRowNumber: row.rowNumber,
      })
      .onConflictDoNothing({ target: legacyRecords.rowFingerprint })
      .returning({ id: legacyRecords.id });

    if (inserted.length === 0) duplicates += 1;
    else imported += 1;
  }

  skipped = rows.length - imported - duplicates - invalid;
  console.log(
    JSON.stringify({
      rows_read: rows.length,
      rows_imported: imported,
      duplicates,
      invalid_rows: invalid,
      rows_skipped: skipped,
    }),
  );
} finally {
  await client.end();
}
