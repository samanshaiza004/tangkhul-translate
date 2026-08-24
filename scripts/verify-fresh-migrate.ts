import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  console.error("TEST_DATABASE_URL is required (must point at a disposable local Postgres).");
  process.exit(1);
}

const url = new URL(testDatabaseUrl);
const host = url.hostname;
const isSupabase = host.endsWith(".supabase.co") || host.endsWith(".supabase.com");
const isLocal = host === "localhost" || host === "127.0.0.1";

if (isSupabase || !isLocal) {
  console.error(
    `Refusing to run against non-local host "${host}". This script is destructive (DROP SCHEMA CASCADE) and TEST_DATABASE_URL must point at a disposable local Postgres, never Supabase or any remote host.`,
  );
  process.exit(1);
}

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

const client = postgres(testDatabaseUrl, { max: 1 });

try {
  await client`DROP SCHEMA IF EXISTS public CASCADE`;
  await client`CREATE SCHEMA public`;
  await client`DROP SCHEMA IF EXISTS drizzle CASCADE`;

  const db = drizzle(client);
  await migrate(db, {
    migrationsFolder: "./drizzle",
    migrationsTable: "__drizzle_migrations",
    migrationsSchema: "drizzle",
  });

  const tables = await client<{ table_name: string }[]>`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `;
  const actual = tables.map((table) => table.table_name).toSorted();
  const missing = expectedTables.filter((table) => !actual.includes(table));
  const extra = actual.filter((table) => !expectedTables.includes(table));

  if (missing.length > 0 || extra.length > 0) {
    console.error(
      `Table mismatch. Missing: ${JSON.stringify(missing)}. Extra: ${JSON.stringify(extra)}.`,
    );
    process.exitCode = 1;
  } else {
    const rlsRows = await client<
      {
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }[]
    >`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = any(${expectedTables})
      order by c.relname
    `;
    const invalidRls = rlsRows.filter(
      (row) => row.relrowsecurity !== true || row.relforcerowsecurity !== false,
    );

    if (rlsRows.length !== expectedTables.length || invalidRls.length > 0) {
      console.error(
        `Expected RLS enabled without FORCE on all public tables, got: ${JSON.stringify(rlsRows)}`,
      );
      process.exitCode = 1;
    }

    const policies = await client<{ count: number }[]>`
      select count(*)::int as count
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = any(${expectedTables})
    `;
    if (policies[0]?.count !== 0) {
      console.error(`Expected no RLS policies, found ${policies[0]?.count}.`);
      process.exitCode = 1;
    }

    const seedRows = await client<{ active: boolean; space_repository: string }[]>`
      select active, space_repository from model_versions order by active, space_repository
    `;

    if (
      seedRows.length !== 2 ||
      seedRows.filter((row) => row.active).length !== 1 ||
      seedRows.filter((row) => !row.active).length !== 1
    ) {
      console.error(`Expected 1 active and 1 inactive model row, got: ${JSON.stringify(seedRows)}`);
      process.exitCode = 1;
    } else {
      if (process.exitCode !== 1) {
        console.log(
          `OK: ${actual.length} tables present, RLS default-deny confirmed, 1 active and 1 inactive model row confirmed.`,
        );
      }
    }
  }
} finally {
  await client.end();
}
