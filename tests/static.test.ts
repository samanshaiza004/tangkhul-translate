import { describe, expect, test } from "bun:test";

import { createApp } from "../src/app";

function makeApp() {
  return createApp({
    checkDatabase: async () => {},
    config: { nodeEnv: "test" },
  });
}

describe("static asset allowlist", () => {
  test("serves the stylesheet with its declared content type", async () => {
    const response = await makeApp().handle(new Request("http://localhost/static/app.css"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toStartWith("text/css");
  });

  test("serves the versioned htmx asset with immutable caching", async () => {
    const response = await makeApp().handle(
      new Request("http://localhost/static/htmx-2.0.10.min.js"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("immutable");
  });

  test("serves the application behavior without immutable caching", async () => {
    const response = await makeApp().handle(new Request("http://localhost/static/app.js"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(body).toContain("htmx:beforeSwap");
    expect(body).toContain("new Set([422, 429, 500, 503])");
    expect(body).toContain("bindCorrectionDirtyState");
  });

  test("keeps translation and feedback announcements in separate live regions", async () => {
    const response = await createApp({
      checkDatabase: async () => {},
      config: { nodeEnv: "test" },
      translator: { translate: async () => ({ inferenceId: "id", output: "translation" }) },
    }).handle(
      new Request("http://localhost/translate", {
        method: "POST",
        headers: { "HX-Request": "true", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ source: "source" }),
      }),
    );
    const body = await response.text();

    expect(body).not.toContain('<section id="result" class="result-region" aria-live=');
    expect(body).toContain('data-translation-output role="status" aria-live="polite"');
    expect(body).toContain('<div id="feedback-message" aria-live="polite">');
  });

  test.each([
    "http://localhost/static/../package.json",
    "http://localhost/static/%2e%2e/package.json",
    "http://localhost/static/..%2Fpackage.json",
    "http://localhost/static/unknown.js",
  ])("returns 404 for a path outside the exact allowlist: %s", async (url) => {
    const response = await makeApp().handle(new Request(url));

    expect(response.status).toBe(404);
  });
});
