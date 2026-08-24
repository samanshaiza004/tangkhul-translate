/* oxlint-disable no-await-in-loop */

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
  PORT: "3319",
  SMOKE_PROVIDER: "deterministic",
};
const child = Bun.spawn(["bun", "run", "src/index.ts"], {
  cwd: root,
  env,
  stdout: "pipe",
  stderr: "pipe",
});
const stdout = new Response(child.stdout).text();
const stderr = new Response(child.stderr).text();
let ready = false;

try {
  const migration = Bun.spawn(["bun", "run", "db:migrate"], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await migration.exited) !== 0) throw new Error("Shutdown smoke migration failed.");

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch("http://127.0.0.1:3319/healthz")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await Bun.sleep(100);
  }
  if (!ready) throw new Error("Production root did not start for shutdown smoke.");

  child.kill("SIGTERM");
  const exitCode = await child.exited;
  const logs = `${await stdout}\n${await stderr}`;
  if (exitCode !== 0 || !logs.includes('"event":"shutdown_complete"')) {
    throw new Error(`Graceful shutdown failed (exit ${exitCode}): ${logs}`);
  }
  console.log("Production-root shutdown smoke passed.");
} finally {
  if (ready && child.exitCode === null) child.kill("SIGKILL");
  await child.exited;
}
