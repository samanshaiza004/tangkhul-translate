import { createApp } from "./app";
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
import { createTranslator } from "./translation";

const config = parseEnv(Bun.env);
const { db } = createDbClient({
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
  config: { nodeEnv: config.nodeEnv },
});

await verifyConfiguredProvenance();
app.listen(config.port);

console.log(
  `tangkhul-translate listening on :${config.port} (db=${redactDatabaseUrl(config.databaseUrl)})`,
);
