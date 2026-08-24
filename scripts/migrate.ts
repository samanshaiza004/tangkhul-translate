import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { parseEnv } from "../src/config";
import { postgresOptions } from "../src/db";

const config = parseEnv(Bun.env);
const client = postgres(
  config.databaseUrl,
  postgresOptions(config.databaseUrl, config.nodeEnv, { max: 1 }),
);

try {
  const db = drizzle(client);
  await migrate(db, {
    migrationsFolder: "./drizzle",
    migrationsTable: "__drizzle_migrations",
    migrationsSchema: "drizzle",
  });
  console.log("Migrations applied.");
} finally {
  await client.end();
}
