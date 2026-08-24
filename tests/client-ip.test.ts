import { expect, test } from "bun:test";

import { resolveFlyClientKey } from "../src/client-ip";

function request(headers: Record<string, string> = {}) {
  return new Request("https://example.test/", { headers });
}

test("uses the provider-authenticated Fly client address", () => {
  expect(
    resolveFlyClientKey({
      request: request({ "Fly-Client-IP": "203.0.113.7" }),
      server: { requestIP: () => ({ address: "10.0.0.2" }) },
    }),
  ).toBe("203.0.113.7");
});

test("ignores a spoofed X-Forwarded-For header", () => {
  expect(
    resolveFlyClientKey({
      request: request({ "X-Forwarded-For": "203.0.113.7" }),
      server: { requestIP: () => ({ address: "10.0.0.2" }) },
    }),
  ).toBe("10.0.0.2");
});

test("falls back safely when Fly metadata is missing or invalid", () => {
  const server = { requestIP: () => null };
  expect(resolveFlyClientKey({ request: request(), server })).toBe("unknown");
  expect(resolveFlyClientKey({ request: request({ "Fly-Client-IP": "not-an-ip" }), server })).toBe(
    "unknown",
  );
});

test("keeps separate provider addresses separate", () => {
  const first = resolveFlyClientKey({
    request: request({ "Fly-Client-IP": "203.0.113.7" }),
    server: null,
  });
  const second = resolveFlyClientKey({
    request: request({ "Fly-Client-IP": "203.0.113.8" }),
    server: null,
  });
  expect(first).not.toBe(second);
});
