import { createApp } from "./app";
import { parseEnv, redactDatabaseUrl } from "./config";
import { checkDatabase as checkDatabaseImpl, createDbClient } from "./db";
import { createFeedbackRecorder } from "./feedback";
import { GradioTranslationProvider } from "./provider";
import type { TranslationProvider } from "./provider";
import { createTranslator } from "./translation";

const config = parseEnv(Bun.env);
const { db } = createDbClient({
  databaseUrl: config.databaseUrl,
  nodeEnv: config.nodeEnv,
});
const checkDatabase = (timeoutMs?: number) => checkDatabaseImpl(db, timeoutMs);
const provider: TranslationProvider =
  Bun.env.SMOKE_PROVIDER === "deterministic"
    ? { translate: async () => "Smoke translation" }
    : new GradioTranslationProvider({
        space: config.hfSpace,
        token: config.hfToken,
        timeoutMs: config.hfTimeoutMs,
      });
const translator = createTranslator(db, provider);
const feedbackRecorder = createFeedbackRecorder(db);

const app = createApp({
  checkDatabase,
  translator,
  feedbackRecorder,
  config: { nodeEnv: config.nodeEnv },
});

app.listen(config.port);

console.log(
  `tangkhul-translate listening on :${config.port} (db=${redactDatabaseUrl(config.databaseUrl)})`,
);
