import { describe, expect, test } from "bun:test";

import { createApp } from "../src/app";
import { CONSENT_VERSION } from "../src/consent";

function translationRequest() {
  return new Request("http://localhost/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "HX-Request": "true",
    },
    body: new URLSearchParams({ source: "source" }),
  });
}

function feedbackRequest() {
  return new Request("http://localhost/feedback", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "HX-Request": "true",
    },
    body: new URLSearchParams({
      inference_id: "saved",
      verdict: "correct",
      consent_version: CONSENT_VERSION,
    }),
  });
}

describe("route rate limits", () => {
  test("limits translations per client key and leaves another key unaffected", async () => {
    let clientKey = "client-a";
    const app = createApp({
      checkDatabase: async () => {},
      config: { nodeEnv: "test" },
      rateLimits: {
        translate: { capacity: 2, refillPerSec: 0 },
      },
      resolveClientKey: () => clientKey,
      translator: {
        translate: async () => ({ inferenceId: "saved", output: "translated" }),
      },
    });

    expect((await app.handle(translationRequest())).status).toBe(200);
    expect((await app.handle(translationRequest())).status).toBe(200);

    const limited = await app.handle(translationRequest());
    const limitedBody = await limited.text();

    expect(limited.status).toBe(429);
    expect(limited.headers.get("X-Translation-Fragment")).toBe("result");
    expect(limitedBody).toContain("Slow down");

    clientKey = "client-b";
    expect((await app.handle(translationRequest())).status).toBe(200);
  });

  test("returns the feedback fragment when feedback is limited", async () => {
    const app = createApp({
      checkDatabase: async () => {},
      config: { nodeEnv: "test" },
      feedbackRecorder: {
        record: async () => ({ outcome: "recorded", status: "recorded" }),
      },
      rateLimits: {
        feedback: { capacity: 1, refillPerSec: 0 },
      },
      resolveClientKey: () => "client-a",
    });

    expect((await app.handle(feedbackRequest())).status).toBe(200);

    const limited = await app.handle(feedbackRequest());
    const limitedBody = await limited.text();

    expect(limited.status).toBe(429);
    expect(limited.headers.get("X-Feedback-Fragment")).toBe("feedback");
    expect(limitedBody).toContain("Slow down");
  });

  test("rejects a forged write before applying an exhausted rate limit", async () => {
    const app = createApp({
      checkDatabase: async () => {},
      config: { nodeEnv: "test" },
      rateLimits: {
        translate: { capacity: 1, refillPerSec: 0 },
      },
      resolveClientKey: () => "client-a",
      translator: {
        translate: async () => ({ inferenceId: "saved", output: "translated" }),
      },
    });

    expect((await app.handle(translationRequest())).status).toBe(200);
    expect((await app.handle(translationRequest())).status).toBe(429);

    const forged = await app.handle(
      new Request("http://localhost/translate", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ source: "source" }),
      }),
    );

    expect(forged.status).toBe(403);
    expect(await forged.text()).toBe("Forbidden");
  });
});
