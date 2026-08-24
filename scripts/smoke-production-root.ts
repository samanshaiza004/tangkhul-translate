/* oxlint-disable no-await-in-loop */

import postgres from "postgres";

import { parseEnv } from "../src/config";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
if (!testDatabaseUrl)
  throw new Error("TEST_DATABASE_URL is required; refusing to smoke canonical Supabase.");
const config = parseEnv({ ...Bun.env, DATABASE_URL: testDatabaseUrl });
const root = new URL("..", import.meta.url).pathname;
const env = {
  ...Bun.env,
  DATABASE_URL: config.databaseUrl,
  NODE_ENV: "test",
  PORT: "3317",
  SMOKE_PROVIDER: "deterministic",
};
const child = Bun.spawn(["bun", "run", "src/index.ts"], {
  cwd: root,
  env,
  stdout: "pipe",
  stderr: "pipe",
});
const sql = postgres(config.databaseUrl, {
  ssl: config.databaseUrl.includes("sslmode=disable") ? false : "require",
  max: 1,
});

try {
  const migration = Bun.spawn(["bun", "run", "db:migrate"], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const migrationCode = await migration.exited;
  if (migrationCode !== 0) throw new Error("Production-root smoke migration failed.");
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      ready = (await fetch("http://127.0.0.1:3317/healthz")).ok;
      if (ready) break;
    } catch {}
    await Bun.sleep(100);
  }
  if (!ready) throw new Error("Production root did not start.");
  const response = await fetch("http://127.0.0.1:3317/translate", {
    method: "POST",
    headers: { "content-type": "application/json", "hx-request": "true" },
    body: JSON.stringify({ source: "Āthum rāra." }),
  });
  const body = await response.text();
  if (response.status !== 200 || !body.includes("Smoke translation")) {
    throw new Error(`Unexpected production-root response ${response.status}: ${body}`);
  }
  const rows =
    await sql`select i.model_output, i.source_raw, mv.model_repository, mv.space_repository from inferences i join model_versions mv on mv.id = i.model_version_id where i.source_raw = ${"Āthum rāra."} order by i.created_at desc limit 1`;
  const row = rows[0];
  if (
    !row ||
    rows.length !== 1 ||
    row.model_output !== "Smoke translation" ||
    row.model_repository !== "chormi/tangkhul-byt5" ||
    row.space_repository !== "chormi/byt5-tang-eng-frontend-demo"
  ) {
    throw new Error(`Expected persisted smoke inference, got ${JSON.stringify(rows)}`);
  }
  console.log("Production-root smoke passed.");
} finally {
  child.kill();
  await child.exited;
  await sql.end();
}
