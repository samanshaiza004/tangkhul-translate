import { createApp } from "./app";
import { resolveFlyClientKey } from "./client-ip";
import { parseEnv, redactDatabaseUrl } from "./config";
import {
  assertActiveSpaceRepository,
  checkDatabase as checkDatabaseImpl,
  createDbClient,
} from "./db";
import { createFeedbackRecorder } from "./feedback";
import { assertSpaceRevision } from "./huggingface";
import { GradioTranslationProvider } from "./provider";
import type { TranslationProvider } from "./provider";
import { logOperational } from "./observability";
import { createShutdownHandler } from "./shutdown";
import { createTranslator } from "./translation";

const config = parseEnv(Bun.env);
const { db, client } = createDbClient({
  databaseUrl: config.databaseUrl,
  nodeEnv: config.nodeEnv,
});
if (Bun.env.SMOKE_PROVIDER !== undefined && config.nodeEnv !== "test") {
  throw new Error("SMOKE_PROVIDER is only allowed when NODE_ENV=test.");
}
if (Bun.env.SMOKE_PROVIDER !== undefined && Bun.env.SMOKE_PROVIDER !== "deterministic") {
  throw new Error(`Unknown SMOKE_PROVIDER ${JSON.stringify(Bun.env.SMOKE_PROVIDER)}.`);
}

const verifyConfiguredProvenance = async () => {
  const active = await assertActiveSpaceRepository(db, config.hfSpace);
  if (config.nodeEnv === "production") {
    await assertSpaceRevision(config.hfSpace, active.spaceRevision);
  }
};

const checkDatabase = async (timeoutMs?: number) => {
  await checkDatabaseImpl(db, timeoutMs);
  await verifyConfiguredProvenance();
};
const provider: TranslationProvider =
  Bun.env.SMOKE_PROVIDER === "deterministic"
    ? { translate: async () => "Smoke translation" }
    : new GradioTranslationProvider({
        space: config.hfSpace,
        token: config.hfToken,
        timeoutMs: config.hfTimeoutMs,
      });
const translator = createTranslator(db, provider, { expectedSpaceRepository: config.hfSpace });
const feedbackRecorder = createFeedbackRecorder(db);

const app = createApp({
  checkDatabase,
  translator,
  feedbackRecorder,
  resolveClientKey: resolveFlyClientKey,
  config: { nodeEnv: config.nodeEnv },
});

try {
  await verifyConfiguredProvenance();
} catch (error) {
  logOperational("startup_provenance_failed", {
    error_class: error instanceof Error ? error.constructor.name : typeof error,
  });
  await client.end();
  process.exit(1);
}
app.listen(config.port);

const shutdown = createShutdownHandler({
  stopServer: async () => {
    await app.stop();
  },
  closeDatabase: () => client.end(),
  onComplete: (timedOut) => {
    logOperational("shutdown_complete", {
      severity: timedOut ? "error" : "info",
      timed_out: timedOut,
    });
    process.exit(timedOut ? 1 : 0);
  },
});
const handleSignal = (signal: string) => {
  logOperational("shutdown_requested", { severity: "info", signal });
  void shutdown().catch(() => {
    logOperational("shutdown_failed");
    process.exit(1);
  });
};
process.once("SIGTERM", () => handleSignal("SIGTERM"));
process.once("SIGINT", () => handleSignal("SIGINT"));

console.log(
  `tangkhul-translate listening on :${config.port} (db=${redactDatabaseUrl(config.databaseUrl)})`,
);
