import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { parseEnv } from "../src/config";

const config = parseEnv(Bun.env);
const client = postgres(config.databaseUrl, {
  ssl: config.databaseUrl.includes("sslmode=disable") ? false : "require",
  // A migration run needs one dedicated connection, not a pool.
  max: 1,
});

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
