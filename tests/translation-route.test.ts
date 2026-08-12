import { describe, expect, test } from "bun:test";

import { createApp } from "../src/app";
import { CONSENT_VERSION } from "../src/consent";
import { FeedbackInputError } from "../src/feedback";
import type { FeedbackRecorder, FeedbackSubmission } from "../src/feedback";
import { ProviderError } from "../src/provider";

function makeApp(translate: (source: string) => Promise<{ inferenceId: string; output: string }>) {
  return createApp({
    checkDatabase: async () => {},
    config: { nodeEnv: "test" },
    translator: { translate },
  });
}

function request(source: string) {
  return new Request("http://localhost/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "HX-Request": "true",
    },
    body: new URLSearchParams({ source }),
  });
}

function makeFeedbackApp(record: FeedbackRecorder["record"]) {
  return createApp({
    checkDatabase: async () => {},
    config: { nodeEnv: "test" },
    feedbackRecorder: { record },
  });
}

function feedbackRequest(body: URLSearchParams, headers: Record<string, string> = {}) {
  return new Request("http://localhost/feedback", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "HX-Request": "true",
      ...headers,
    },
    body,
  });
}

describe("POST /translate", () => {
  test("renders a persisted translation fragment and escapes provider HTML", async () => {
    const app = makeApp(async (source) => {
      expect(source).toBe("Āthum rāra.");
      return { inferenceId: "saved", output: '<script>alert("x")</script>' };
    });

    const response = await app.handle(request("Āthum rāra."));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Translation-Fragment")).toBe("result");
    expect(body).toContain("&lt;script&gt;");
    expect(body).not.toContain("<script>alert");
    expect(body).toContain("data-copy-result");
    expect(body).toContain("data-toggle-correction");
    expect(body).toContain('hx-post="/feedback"');
    expect(body).toContain("saved");

    const pageResponse = await app.handle(new Request("http://localhost/"));
    const pageBody = await pageResponse.text();
    expect(pageBody).toContain(
      "Translations are stored to improve this translator. Avoid private or identifying text.",
    );
  });

  test.each([
    ["missing htmx header", {}],
    ["cross-site request", { "HX-Request": "true", "Sec-Fetch-Site": "cross-site" }],
  ])("rejects a %s", async (_description, headers) => {
    let translated = false;
    const app = makeApp(async () => {
      translated = true;
      return { inferenceId: "saved", output: "result" };
    });
    const response = await app.handle(
      new Request("http://localhost/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...headers,
        },
        body: new URLSearchParams({ source: "source" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden");
    expect(translated).toBeFalse();
  });

  test.each([
    [new ProviderError("input_too_long", "limit"), 422, "This text is too long"],
    [new ProviderError("timeout", "slow"), 503, "Translation timed out"],
    [new ProviderError("unavailable", "down"), 503, "Model not available"],
    [new Error("database secret"), 500, "Translation could not be saved"],
  ] as const)("returns a swappable error fragment", async (error, status, expected) => {
    const response = await makeApp(async () => {
      throw error;
    }).handle(request("source"));
    const body = await response.text();

    expect(response.status).toBe(status);
    expect(response.headers.get("X-Translation-Fragment")).toBe("result");
    expect(body).toContain(expected);
    expect(body).not.toContain("database secret");
  });
});

describe("POST /feedback", () => {
  test.each([
    ["correct", "Recorded as correct."],
    ["unclear", "Recorded as unclear."],
  ])("renders the distinct %s confirmation", async (verdict, expectedMessage) => {
    let received: FeedbackSubmission | undefined;
    const app = makeFeedbackApp(async (submission) => {
      received = submission;
      return { outcome: "recorded", status: "recorded" };
    });
    const response = await app.handle(
      feedbackRequest(
        new URLSearchParams({
          inference_id: "saved",
          verdict,
          consent_version: CONSENT_VERSION,
        }),
      ),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Feedback-Fragment")).toBe("feedback");
    expect(response.headers.get("HX-Retarget")).toBe("#feedback-zone");
    expect(response.headers.get("HX-Reswap")).toBe("innerHTML");
    expect(body).toContain(expectedMessage);
    expect(received).toEqual({
      inferenceId: "saved",
      verdict,
      proposedTranslation: undefined,
      contributorNote: undefined,
      tags: undefined,
      consentVersion: CONSENT_VERSION,
    });
  });

  test("normalizes repeated urlencoded tags and renders pending review", async () => {
    let received: FeedbackSubmission | undefined;
    const app = makeFeedbackApp(async (submission) => {
      received = submission;
      return { outcome: "recorded", status: "pending_review" };
    });
    const body = new URLSearchParams({
      inference_id: "saved",
      verdict: "incorrect",
      proposed_translation: "Corrected translation",
      contributor_note: "A note",
      consent_version: CONSENT_VERSION,
    });
    body.append("tags", "wrong_meaning");
    body.append("tags", "unnatural_english");

    const response = await app.handle(feedbackRequest(body));
    const responseBody = await response.text();

    expect(response.status).toBe(200);
    expect(responseBody).toContain(
      "Submitted for human review. It will not enter training automatically.",
    );
    expect(received?.tags).toEqual(["wrong_meaning", "unnatural_english"]);
  });

  test("renders duplicate and escaped input errors", async () => {
    const duplicateResponse = await makeFeedbackApp(async () => ({ outcome: "duplicate" })).handle(
      feedbackRequest(
        new URLSearchParams({
          inference_id: "saved",
          verdict: "correct",
          consent_version: CONSENT_VERSION,
        }),
      ),
    );
    expect(await duplicateResponse.text()).toContain(
      "Feedback was already recorded for this translation.",
    );

    const errorResponse = await makeFeedbackApp(async () => {
      throw new FeedbackInputError("invalid_request", "Bad <script>alert(1)</script>");
    }).handle(
      feedbackRequest(
        new URLSearchParams({
          inference_id: "saved",
          verdict: "correct",
          consent_version: CONSENT_VERSION,
        }),
      ),
    );
    const errorBody = await errorResponse.text();
    expect(errorResponse.status).toBe(422);
    expect(errorResponse.headers.get("X-Feedback-Fragment")).toBe("feedback");
    expect(errorBody).toContain("Bad &lt;script&gt;");
    expect(errorBody).not.toContain("<script>alert");
  });

  test("rejects a forged request before recording feedback", async () => {
    let recorded = false;
    const app = makeFeedbackApp(async () => {
      recorded = true;
      return { outcome: "recorded", status: "recorded" };
    });
    const response = await app.handle(
      new Request("http://localhost/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          inference_id: "saved",
          verdict: "correct",
          consent_version: CONSENT_VERSION,
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden");
    expect(recorded).toBeFalse();
  });
});
