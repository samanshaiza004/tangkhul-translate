import { describe, expect, test } from "bun:test";

import { parseEnv, redactDatabaseUrl } from "../src/config";

describe("parseEnv", () => {
  test("requires DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow("DATABASE_URL is required");
  });

  test("rejects an invalid PORT", () => {
    expect(() => parseEnv({ DATABASE_URL: "postgresql://u:p@h/db", PORT: "abc" })).toThrow("PORT");
  });

  test("applies optional defaults", () => {
    const config = parseEnv({ DATABASE_URL: "postgresql://u:p@h/db" });

    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe("development");
    expect(config.hfSpace).toBe("chormi/byt5-tang-eng-frontend-demo");
    expect(config.hfTimeoutMs).toBe(180_000);
    expect(config.hfToken).toBeUndefined();
  });

  test("validates Hugging Face settings", () => {
    expect(() =>
      parseEnv({ DATABASE_URL: "postgresql://u:p@h/db", HF_SPACE: "not-a-repository" }),
    ).toThrow("HF_SPACE");
    expect(() =>
      parseEnv({ DATABASE_URL: "postgresql://u:p@h/db", HF_TOKEN: "not-a-token" }),
    ).toThrow("HF_TOKEN");
    expect(() => parseEnv({ DATABASE_URL: "postgresql://u:p@h/db", HF_TIMEOUT_MS: "999" })).toThrow(
      "HF_TIMEOUT_MS",
    );
  });

  test("collects all validation problems in one error", () => {
    let thrown: unknown;

    try {
      parseEnv({ PORT: "abc" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("DATABASE_URL is required");
    expect(message).toContain("PORT must be an integer");
  });

  test("rejects a non-Postgres DATABASE_URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://u:p@h/db" })).toThrow(
      'DATABASE_URL must start with "postgres://" or "postgresql://"',
    );
  });
});

describe("redactDatabaseUrl", () => {
  test("removes the database password", () => {
    const redacted = redactDatabaseUrl("postgresql://user:secretpass@host:5432/db");

    expect(redacted).not.toContain("secretpass");
  });
});
