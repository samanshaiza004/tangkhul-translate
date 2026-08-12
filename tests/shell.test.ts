import { describe, expect, test } from "bun:test";

import { createApp } from "../src/app";

describe("translation shell", () => {
  test("GET / returns the secured static page shell", async () => {
    const app = createApp({
      checkDatabase: async () => {},
      config: { nodeEnv: "test" },
    });

    const response = await app.handle(new Request("http://localhost/"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toStartWith("text/html");
    expect(body).toContain("width=device-width");
    expect(body).toContain('lang="en"');
    expect(body).toContain('name="htmx-config"');
    expect(body).toContain('"allowEval": false');
    expect(body).toContain('"includeIndicatorStyles": false');
    expect(body).toContain("/static/htmx-2.0.10.min.js");
    expect(body).toContain("/static/app.css");
    expect(body).toContain("Write it as you say it.");
    expect(body).toContain('hx-post="/translate"');
    expect(body).toContain("/static/app.js");
    expect(body).toContain("A̱");
    expect(body).toContain("a̱");
    expect(body.match(/<main/g)?.length).toBe(1);
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(body).not.toContain("[object");
  });
});
