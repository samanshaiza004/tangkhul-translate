import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import postgres from "postgres";

const drizzleDirectory = resolve(import.meta.dir, "../drizzle");
const expectedTables = [
  "dataset_exports",
  "feedback",
  "feedback_tags",
  "inferences",
  "legacy_records",
  "model_versions",
  "review_tags",
  "reviews",
];

interface MigrationJournal {
  entries: { tag: string }[];
}

describe("committed migrations", () => {
  test("the journal references present, non-destructive SQL files", async () => {
    const journal = JSON.parse(
      await readFile(resolve(drizzleDirectory, "meta/_journal.json"), "utf8"),
    ) as MigrationJournal;
    const migrationFiles = (await readdir(drizzleDirectory))
      .filter((file) => file.endsWith(".sql"))
      .toSorted();

    for (const entry of journal.entries) {
      expect(migrationFiles).toContain(`${entry.tag}.sql`);
    }

    const migrationContents = await Promise.all(
      migrationFiles.map((migrationFile) =>
        readFile(resolve(drizzleDirectory, migrationFile), "utf8"),
      ),
    );

    for (const contents of migrationContents) {
      expect(contents.trim().length).toBeGreaterThan(0);
      expect(contents).not.toContain("DROP TABLE");
    }
  });
});

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

describe("migrated database", () => {
  test.skipIf(!testDatabaseUrl)("has the expected tables and seed row", async () => {
    if (!testDatabaseUrl) {
      throw new Error("TEST_DATABASE_URL is required for this test");
    }

    const client = postgres(testDatabaseUrl, { max: 1 });

    try {
      const tables = await client<{ table_name: string }[]>`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
        order by table_name
      `;
      const actual = tables.map((table) => table.table_name).toSorted();
      expect(actual).toEqual(expectedTables);

      const seedRows = await client<{ active: boolean; space_repository: string }[]>`
        select active, space_repository from model_versions order by active, space_repository
      `;
      expect(seedRows).toHaveLength(2);
      expect(seedRows.filter((row) => row.active)).toHaveLength(1);
      expect(seedRows.filter((row) => !row.active)).toHaveLength(1);
      expect(seedRows.find((row) => row.active)?.space_repository).toBe(
        "chormi/byt5-tang-eng-frontend-demo",
      );
    } finally {
      await client.end();
    }
  });
});
