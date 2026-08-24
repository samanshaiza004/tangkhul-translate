/* oxlint-disable no-await-in-loop */

import postgres from "postgres";

import { parseEnv } from "../src/config";
import { postgresOptions } from "../src/db";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
if (!testDatabaseUrl)
  throw new Error("TEST_DATABASE_URL is required; refusing to smoke canonical Supabase.");
const config = parseEnv({ ...Bun.env, DATABASE_URL: testDatabaseUrl });
const root = new URL("..", import.meta.url).pathname;
const env = { ...Bun.env, DATABASE_URL: config.databaseUrl, NODE_ENV: "test", PORT: "3318" };
const child = Bun.spawn(["bun", "run", "src/index.ts"], {
  cwd: root,
  env,
  stdout: "pipe",
  stderr: "pipe",
});
const sql = postgres(
  config.databaseUrl,
  postgresOptions(config.databaseUrl, config.nodeEnv, { max: 1 }),
);

try {
  const migration = Bun.spawn(["bun", "run", "db:migrate"], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const migrationCode = await migration.exited;
  if (migrationCode !== 0) throw new Error("Live smoke migration failed.");
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      ready = (await fetch("http://127.0.0.1:3318/healthz")).ok;
      if (ready) break;
    } catch {}
    await Bun.sleep(250);
  }
  if (!ready) throw new Error("Live production root did not start.");
  const source = "Āthum rāra.";
  const response = await fetch("http://127.0.0.1:3318/translate", {
    method: "POST",
    headers: { "content-type": "application/json", "hx-request": "true" },
    body: JSON.stringify({ source }),
  });
  const body = await response.text();
  if (response.status !== 200 || !body.includes("translation-output")) {
    throw new Error(`Unexpected live response ${response.status}: ${body}`);
  }
  const rows =
    await sql`select model_output, source_raw from inferences where source_raw = ${source} order by created_at desc limit 1`;
  const row = rows[0];
  if (
    !row ||
    rows.length !== 1 ||
    typeof row.model_output !== "string" ||
    row.model_output.length === 0
  ) {
    throw new Error(`Expected persisted live inference, got ${JSON.stringify(rows)}`);
  }
  console.log("Live production-root smoke passed.");
} finally {
  child.kill();
  await child.exited;
  await sql.end();
}
