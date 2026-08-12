import { describe, expect, test } from "bun:test";

// This static import is intentional: reaching the tests proves app.tsx has no
// environment parsing or other import-time side effects.
import { createApp } from "../src/app";

describe("health routes", () => {
  test("GET /healthz reports process health without external checks", async () => {
    const app = createApp({
      checkDatabase: async () => {},
      config: { nodeEnv: "test" },
    });

    const response = await app.handle(new Request("http://localhost/healthz"));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(typeof body.uptime_s).toBe("number");
    expect(typeof body.pid).toBe("number");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("GET /readyz reports a successful database check", async () => {
    const app = createApp({
      checkDatabase: async () => {},
      config: { nodeEnv: "test" },
    });

    const response = await app.handle(new Request("http://localhost/readyz"));
    const body = (await response.json()) as {
      checks: { database: string };
      latency_ms: unknown;
    };

    expect(response.status).toBe(200);
    expect(body.checks.database).toBe("ok");
    expect(typeof body.latency_ms).toBe("number");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("GET /readyz returns a generic failure without leaking database details", async () => {
    const app = createApp({
      checkDatabase: async () => {
        throw new Error("connection refused to postgres://real-host/real-db with password hunter2");
      },
      config: { nodeEnv: "test" },
    });

    const response = await app.handle(new Request("http://localhost/readyz"));
    const rawBody = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    for (const sensitiveText of ["hunter2", "postgres", "real-host", "stack", "Error"]) {
      expect(rawBody).not.toContain(sensitiveText);
    }
  });
});
