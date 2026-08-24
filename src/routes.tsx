import { Elysia, t } from "elysia";
import type { Context } from "elysia";
import { html } from "@elysia/html";

import type { ResolveClientKey } from "./app";
import { CONSENT_VERSION } from "./consent";
import { FeedbackInputError } from "./feedback";
import type { FeedbackRecorder } from "./feedback";
import { ProviderError } from "./provider";
import { createRateLimiter, hashClientKey } from "./ratelimit";
import type { RateLimiter, RateLimiterOptions } from "./ratelimit";
import { getRequestId, logOperational } from "./observability";
import type { Translator } from "./translation";
import { TranslationInputError } from "./translation";
import { FeedbackError, FeedbackStatus, Page, TranslationError, TranslationResult } from "./views";

export interface RouteRateLimitOptions {
  translate?: RateLimiterOptions;
  feedback?: RateLimiterOptions;
}

export interface CreateRoutesOptions {
  checkDatabase: (timeoutMs?: number) => Promise<void>;
  feedbackRecorder: FeedbackRecorder;
  rateLimits?: RouteRateLimitOptions;
  resolveClientKey: ResolveClientKey;
  translator: Translator;
}

const DEFAULT_TRANSLATE_RATE_LIMIT: RateLimiterOptions = {
  capacity: 15,
  refillPerSec: 15 / 60,
};

const DEFAULT_FEEDBACK_RATE_LIMIT: RateLimiterOptions = {
  capacity: 30,
  refillPerSec: 30 / 60,
};

type RateLimitContext = Pick<Context, "request" | "server" | "set">;

function makeRateLimitGuard({
  limiter,
  resolveClientKey,
  fragmentHeaderName,
  fragmentHeaderValue,
  renderLimited,
}: {
  limiter: RateLimiter;
  resolveClientKey: ResolveClientKey;
  fragmentHeaderName: string;
  fragmentHeaderValue: string;
  renderLimited: () => JSX.Element;
}) {
  return (ctx: RateLimitContext) => {
    const rawKey = resolveClientKey({ request: ctx.request, server: ctx.server });
    const hashedKey = hashClientKey(rawKey);

    if (limiter.take(hashedKey)) {
      return undefined;
    }

    ctx.set.status = 429;
    ctx.set.headers[fragmentHeaderName] = fragmentHeaderValue;
    return renderLimited();
  };
}

function rejectForgedWrite({
  request,
  set,
}: {
  request: Request;
  set: { status?: number | string };
}): Response | undefined {
  if (request.headers.get("HX-Request") !== "true") {
    set.status = 403;
    return new Response("Forbidden", { status: 403 });
  }

  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    set.status = 403;
    return new Response("Forbidden", { status: 403 });
  }

  return undefined;
}

export function createRoutes({
  checkDatabase,
  feedbackRecorder,
  rateLimits,
  resolveClientKey,
  translator,
}: CreateRoutesOptions) {
  const translateLimiter = createRateLimiter(rateLimits?.translate ?? DEFAULT_TRANSLATE_RATE_LIMIT);
  const feedbackLimiter = createRateLimiter(rateLimits?.feedback ?? DEFAULT_FEEDBACK_RATE_LIMIT);
  const translateRateLimitGuard = makeRateLimitGuard({
    limiter: translateLimiter,
    resolveClientKey,
    fragmentHeaderName: "X-Translation-Fragment",
    fragmentHeaderValue: "result",
    renderLimited: () => (
      <TranslationError
        title="Slow down"
        message="You're going a little fast — wait a moment and try again."
      />
    ),
  });
  const feedbackRateLimitGuard = makeRateLimitGuard({
    limiter: feedbackLimiter,
    resolveClientKey,
    fragmentHeaderName: "X-Feedback-Fragment",
    fragmentHeaderValue: "feedback",
    renderLimited: () => (
      <FeedbackError
        title="Slow down"
        message="You're going a little fast — wait a moment and try again."
      />
    ),
  });

  return new Elysia()
    .use(html({ contentType: "text/html; charset=utf-8" }))
    .get("/", () => <Page />)
    .get("/healthz", ({ set }) => {
      set.headers["Cache-Control"] = "no-store";

      return {
        status: "ok",
        uptime_s: Math.round(process.uptime()),
        pid: process.pid,
      };
    })
    .get("/readyz", async ({ request, set }) => {
      set.headers["Cache-Control"] = "no-store";
      const startedAt = performance.now();

      try {
        await checkDatabase(1500);

        return {
          status: "ready",
          checks: { database: "ok" },
          latency_ms: Math.round(performance.now() - startedAt),
        };
      } catch (error) {
        logOperational("readiness_failed", {
          request_id: getRequestId(request),
          error_class: error instanceof Error ? error.constructor.name : typeof error,
        });
        set.status = 503;

        return {
          status: "not_ready",
          checks: { database: "fail" },
        };
      }
    })
    .post(
      "/translate",
      async ({ body, request, set }) => {
        set.headers["Cache-Control"] = "no-store";
        set.headers["X-Translation-Fragment"] = "result";
        const source = typeof body.source === "string" ? body.source : "";

        try {
          const result = await translator.translate(source);
          return (
            <TranslationResult
              inferenceId={result.inferenceId}
              output={result.output}
              consentVersion={CONSENT_VERSION}
            />
          );
        } catch (error) {
          if (
            error instanceof TranslationInputError ||
            (error instanceof ProviderError && error.code === "input_too_long")
          ) {
            set.status = 422;
            return (
              <TranslationError
                title={
                  error instanceof TranslationInputError
                    ? "Enter some Tangkhul text"
                    : "This text is too long"
                }
                message={
                  error instanceof TranslationInputError
                    ? "Type or paste a phrase before translating."
                    : "The complete model input is over 512 tokens. Translate a shorter passage."
                }
              />
            );
          }

          if (error instanceof ProviderError) {
            set.status = 503;
            return (
              <TranslationError
                title={error.code === "timeout" ? "Translation timed out" : "Model not available"}
                message={
                  error.code === "timeout"
                    ? "The model did not finish within the configured time."
                    : "The model may be starting or temporarily unavailable."
                }
                retry
              />
            );
          }

          logOperational("translation_failed", {
            request_id: getRequestId(request),
            error_class: error instanceof Error ? error.constructor.name : typeof error,
          });
          set.status = 500;
          return (
            <TranslationError
              title="Translation could not be saved"
              message="No result was shown because the translation was not recorded."
              retry
            />
          );
        }
      },
      {
        body: t.Object({ source: t.String() }),
        beforeHandle: [rejectForgedWrite, translateRateLimitGuard],
      },
    )
    .post(
      "/feedback",
      async ({ body, request, set }) => {
        set.headers["Cache-Control"] = "no-store";
        set.headers["X-Feedback-Fragment"] = "feedback";

        const rawTags = body.tags;
        const tags =
          rawTags === undefined ? undefined : Array.isArray(rawTags) ? rawTags : [rawTags];

        try {
          const outcome = await feedbackRecorder.record({
            inferenceId: body.inference_id,
            verdict: body.verdict,
            proposedTranslation: body.proposed_translation,
            contributorNote: body.contributor_note,
            tags,
            consentVersion: body.consent_version,
          });

          set.headers["HX-Retarget"] = "#feedback-zone";
          set.headers["HX-Reswap"] = "innerHTML";

          if (outcome.outcome === "duplicate") {
            return <FeedbackStatus variant="duplicate" />;
          }

          if (outcome.status === "pending_review") {
            return <FeedbackStatus variant="pending_review" />;
          }

          return <FeedbackStatus variant={body.verdict === "unclear" ? "unclear" : "correct"} />;
        } catch (error) {
          if (error instanceof FeedbackInputError) {
            set.status = 422;
            return <FeedbackError title="Feedback not submitted" message={error.message} />;
          }

          const sqlstate = (error as { code?: unknown })?.code;
          const constraintName = (error as { constraint_name?: unknown })?.constraint_name;
          logOperational("feedback_recording_failed", {
            request_id: getRequestId(request),
            error_class: error instanceof Error ? error.constructor.name : typeof error,
            sqlstate: typeof sqlstate === "string" ? sqlstate : undefined,
            constraint: typeof constraintName === "string" ? constraintName : undefined,
          });
          set.status = 500;
          return (
            <FeedbackError
              title="Feedback could not be saved"
              message="Something went wrong. Try again in a moment."
            />
          );
        }
      },
      {
        body: t.Object({
          inference_id: t.String(),
          verdict: t.String(),
          proposed_translation: t.Optional(t.String({ maxLength: 8000 })),
          contributor_note: t.Optional(t.String({ maxLength: 2000 })),
          consent_version: t.String(),
          tags: t.Optional(t.Union([t.String(), t.Array(t.String())])),
        }),
        beforeHandle: [rejectForgedWrite, feedbackRateLimitGuard],
      },
    );
}
