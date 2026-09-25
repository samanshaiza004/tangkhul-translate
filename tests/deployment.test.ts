import { expect, test } from "bun:test";

test("production artifact is pinned and excludes development secrets", async () => {
  const dockerfile = await Bun.file("Dockerfile").text();

  expect(dockerfile).toContain("oven/bun:1.3.14-slim");
  expect(dockerfile).toContain("bun install --frozen-lockfile --production");
  expect(dockerfile).toContain("USER bun");
  expect(dockerfile).not.toContain("COPY .env");
  expect(await Bun.file(".dockerignore").text()).toContain(".env");
});

test("Fly deployment checks readiness and keeps one process running", async () => {
  const config = await Bun.file("fly.toml").text();
  const docs = await Bun.file("docs/deployment.md").text();

  expect(config).toContain('path = "/readyz"');
  expect(config).toContain('auto_stop_machines = "off"');
  expect(config).toContain('primary_region = "ord"');
  expect(docs).toContain("Fly-Client-IP");
  expect(docs).toContain("gblybekxtsbiciuzqhmu");
});
