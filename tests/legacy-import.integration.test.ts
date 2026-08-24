import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import postgres from "postgres";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const root = resolve(import.meta.dir, "..");

async function runImporter(csvPath: string) {
  const child = Bun.spawn(["bun", "scripts/legacy-import-sheet.ts", csvPath], {
    cwd: root,
    env: { ...Bun.env, DATABASE_URL: testDatabaseUrl, NODE_ENV: "test" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

function report(stdout: string): Record<string, number> {
  return JSON.parse(stdout.trim().split("\n").at(-1)!) as Record<string, number>;
}

test.skipIf(!testDatabaseUrl)(
  "imports legacy rows idempotently as unverified records",
  async () => {
    if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required for this test");

    const tempDir = await mkdtemp("/tmp/tangkhul-legacy-");
    const csvPath = join(tempDir, "legacy.csv");
    const source = "Āthum rāra.";
    const correction = "Those two are coming.";
    await writeFile(csvPath, `source,correction\n"${source}","${correction}"\n`);
    const client = postgres(testDatabaseUrl, { max: 1 });

    try {
      const first = await runImporter(csvPath);
      expect(first.code).toBe(0);
      expect(report(first.stdout)).toMatchObject({
        rows_read: 1,
        rows_imported: 1,
        duplicates: 0,
        invalid_rows: 0,
      });

      const rows = await client`
      select source_raw, correction, provenance, consent_version, verification_status
      from legacy_records where source_raw = ${source}
    `;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.source_raw).toBe(source);
      expect(rows[0]?.correction).toBe(correction);
      expect(rows[0]?.provenance).toBe("legacy_google_sheet");
      expect(rows[0]?.consent_version).toBe("legacy_or_unknown");
      expect(rows[0]?.verification_status).toBe("unverified");

      const second = await runImporter(csvPath);
      expect(second.code).toBe(0);
      expect(report(second.stdout)).toMatchObject({
        rows_read: 1,
        rows_imported: 0,
        duplicates: 1,
      });
    } finally {
      await client`delete from legacy_records where source_raw = ${source}`;
      await client.end();
      await rm(tempDir, { recursive: true, force: true });
    }
  },
);
