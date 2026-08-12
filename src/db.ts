import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export interface DbClientOptions {
  databaseUrl: string;
  nodeEnv: "development" | "test" | "production";
}

export function createDbClient({ databaseUrl, nodeEnv }: DbClientOptions) {
  const client = postgres(databaseUrl, {
    ssl: databaseUrl.includes("sslmode=disable") ? false : "require",
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
  });

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
