export interface Config {
  databaseUrl: string;
  port: number;
  nodeEnv: "development" | "test" | "production";
  hfSpace: string;
  hfToken?: `hf_${string}`;
  hfTimeoutMs: number;
}

const NODE_ENVIRONMENTS = ["development", "test", "production"] as const;

export function parseEnv(raw: Record<string, string | undefined>): Config {
  const problems: string[] = [];
  const databaseUrl = raw.DATABASE_URL;
  const rawPort = raw.PORT;
  const rawNodeEnv = raw.NODE_ENV;
  const hfSpace = raw.HF_SPACE ?? "chormi/byt5-tang-eng-frontend-demo";
  const hfToken = raw.HF_TOKEN;
  const rawHfTimeoutMs = raw.HF_TIMEOUT_MS;

  if (databaseUrl === undefined || databaseUrl.length === 0) {
    problems.push("DATABASE_URL is required");
  } else if (!databaseUrl.startsWith("postgres://") && !databaseUrl.startsWith("postgresql://")) {
    problems.push('DATABASE_URL must start with "postgres://" or "postgresql://"');
  }

  const port = rawPort === undefined ? 3000 : Number(rawPort);
  if (
    (rawPort !== undefined && !/^\d+$/.test(rawPort)) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    problems.push(`PORT must be an integer between 1 and 65535 (got ${JSON.stringify(rawPort)})`);
  }

  const nodeEnv = rawNodeEnv ?? "development";
  if (!NODE_ENVIRONMENTS.some((environment) => environment === nodeEnv)) {
    problems.push(
      `NODE_ENV must be one of "development", "test", or "production" (got ${JSON.stringify(rawNodeEnv)})`,
    );
  }

  if (!/^[\w.-]+\/[\w.-]+$/.test(hfSpace)) {
    problems.push(`HF_SPACE must be an owner/name repository id (got ${JSON.stringify(hfSpace)})`);
  }

  if (hfToken !== undefined && hfToken.length > 0 && !hfToken.startsWith("hf_")) {
    problems.push('HF_TOKEN must start with "hf_" when provided');
  }

  const hfTimeoutMs = rawHfTimeoutMs === undefined ? 180_000 : Number(rawHfTimeoutMs);
  if (
    (rawHfTimeoutMs !== undefined && !/^\d+$/.test(rawHfTimeoutMs)) ||
    !Number.isInteger(hfTimeoutMs) ||
    hfTimeoutMs < 1_000 ||
    hfTimeoutMs > 600_000
  ) {
    problems.push(
      `HF_TIMEOUT_MS must be an integer between 1000 and 600000 (got ${JSON.stringify(rawHfTimeoutMs)})`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
  }

  return {
    databaseUrl: databaseUrl as string,
    port,
    nodeEnv: nodeEnv as Config["nodeEnv"],
    hfSpace,
    hfToken: hfToken ? (hfToken as `hf_${string}`) : undefined,
    hfTimeoutMs,
  };
}

export function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return "postgres://[redacted]";
    }

    if (parsed.password) {
      parsed.password = "***";
    }

    return parsed.toString();
  } catch {
    return "postgres://[redacted]";
  }
}
