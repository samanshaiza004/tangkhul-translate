import { Elysia } from "elysia";

import { createRoutes } from "./routes";
import type { RouteRateLimitOptions } from "./routes";
import { createStaticRoutes } from "./static";
import type { Config } from "./config";
import type { FeedbackRecorder } from "./feedback";
import type { Translator } from "./translation";

export type ResolveClientKey = (ctx: { request: Request; server: unknown }) => string;

export interface CreateAppOptions {
  checkDatabase: (timeoutMs?: number) => Promise<void>;
  feedbackRecorder?: FeedbackRecorder;
  rateLimits?: RouteRateLimitOptions;
  resolveClientKey?: ResolveClientKey;
  translator?: Translator;
  config: Pick<Config, "nodeEnv">;
}

// This is the address Bun observed on the raw TCP connection, which is correct
// for a single instance with no reverse proxy. Before deploying behind a load
// balancer, CDN, or proxy, replace this with a resolver for the platform's
// guaranteed client-IP header (for example, Fly-Client-IP or a trusted-proxy-
// validated X-Forwarded-For chain). Never trust arbitrary client-supplied
// X-Forwarded-For: it would make the rate limit trivial to bypass.
const DEFAULT_RESOLVE_CLIENT_KEY: ResolveClientKey = ({ request, server }) => {
  const bunServer = server as {
    requestIP?: (req: Request) => { address: string } | null;
  } | null;
  const address = bunServer?.requestIP?.(request)?.address;
  return address ?? "unknown";
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
} as const;

export function createApp({
  checkDatabase,
  feedbackRecorder,
  rateLimits,
  resolveClientKey,
  translator,
  config,
}: CreateAppOptions) {
  const routeTranslator: Translator = translator ?? {
    translate: async () => {
      throw new Error("Translator is not configured.");
    },
  };
  const routeFeedbackRecorder: FeedbackRecorder = feedbackRecorder ?? {
    record: async () => {
      throw new Error("Feedback recorder is not configured.");
    },
  };

  return new Elysia({ serve: { maxRequestBodySize: 64 * 1024 } })
    .onRequest(({ set }) => {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        set.headers[name] = value;
      }
    })
    .onError(({ error, code, set }) => {
      console.error("Unhandled request error:", error);

      set.status =
        typeof code === "number"
          ? code
          : code === "NOT_FOUND"
            ? 404
            : code === "PARSE"
              ? 400
              : code === "VALIDATION"
                ? 422
                : 500;

      if (config.nodeEnv === "production") {
        return { error: "internal_error" };
      }

      return {
        error: typeof code === "string" ? code.toLowerCase() : "request_error",
        detail: error instanceof Error ? error.message : String(error),
      };
    })
    .use(createStaticRoutes())
    .use(
      createRoutes({
        checkDatabase,
        feedbackRecorder: routeFeedbackRecorder,
        rateLimits,
        resolveClientKey: resolveClientKey ?? DEFAULT_RESOLVE_CLIENT_KEY,
        translator: routeTranslator,
      }),
    );
}
