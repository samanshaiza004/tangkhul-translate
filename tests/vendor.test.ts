import { describe, expect, test } from "bun:test";

const EXPECTED_HTMX_SHA256 = "71ea67185bfa8c98c39d31717c6fce5d852370fcdfd129db4543774d3145c0de";

async function sha256(path: string) {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(path).arrayBuffer());
  return hasher.digest("hex");
}

describe("vendored htmx", () => {
  test("matches htmx.org 2.0.10 exactly", async () => {
    expect(await sha256("public/htmx-2.0.10.min.js")).toBe(EXPECTED_HTMX_SHA256);
    expect(await sha256("node_modules/htmx.org/dist/htmx.min.js")).toBe(EXPECTED_HTMX_SHA256);
  });
});
