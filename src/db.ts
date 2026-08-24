import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export interface DbClientOptions {
  databaseUrl: string;
  nodeEnv: "development" | "test" | "production";
}

export function postgresOptions(
  databaseUrl: string,
  nodeEnv: DbClientOptions["nodeEnv"],
  overrides: Partial<Parameters<typeof postgres>[1]> = {},
) {
  return {
    ssl: databaseUrl.includes("sslmode=disable") ? false : ("require" as const),
    max: nodeEnv === "production" ? 10 : 3,
    connect_timeout: 5,
    idle_timeout: 30,
    max_lifetime: 60 * 30,
    // Prepared statements are supported by Supavisor's session pooler. Do not
    // disable them based on guidance intended for the transaction pooler.
    prepare: true,
    // Supabase emits chatty notices that should not clutter application logs.
    onnotice: () => {},
    connection: { application_name: "tangkhul-translate" },
    ...overrides,
  };
}

export function createDbClient({ databaseUrl, nodeEnv }: DbClientOptions) {
  const client = postgres(databaseUrl, postgresOptions(databaseUrl, nodeEnv));

  const db = drizzle(client, { schema, logger: nodeEnv !== "production" });

  return { client, db };
}

export async function checkDatabase(
  db: ReturnType<typeof createDbClient>["db"],
  timeoutMs = 1500,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      db.execute(sql`select count(*)::int as n from model_versions`),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Database readiness check timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export async function readActiveModelProvenance(
  db: ReturnType<typeof createDbClient>["db"],
): Promise<{ spaceRepository: string; spaceRevision: string }> {
  const rows = await db
    .select({
      spaceRepository: schema.modelVersions.spaceRepository,
      spaceRevision: schema.modelVersions.spaceRevision,
    })
    .from(schema.modelVersions)
    .where(sql`${schema.modelVersions.active} = true`)
    .limit(2);

  if (rows.length !== 1) {
    throw new Error(`Expected exactly one active model version, found ${rows.length}.`);
  }
  return rows[0]!;
}

export async function assertActiveSpaceRepository(
  db: ReturnType<typeof createDbClient>["db"],
  expectedSpace: string,
): Promise<{ spaceRepository: string; spaceRevision: string }> {
  const active = await readActiveModelProvenance(db);
  if (active.spaceRepository !== expectedSpace) {
    throw new Error(
      `Configured HF_SPACE ${expectedSpace} does not match active model Space ${active.spaceRepository}.`,
    );
  }
  return active;
}
