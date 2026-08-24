import { expect, test } from "bun:test";

import { legacyRowFingerprint, parseLegacyCsv } from "../src/legacy";

test("parses quoted legacy corrections without changing their text", () => {
  const [header, row] = parseLegacyCsv('source,correction\n"Āthum rāra.","Those, two\ncome."\n');

  expect(header?.values).toEqual(["source", "correction"]);
  expect(row?.values).toEqual(["Āthum rāra.", "Those, two\ncome."]);
});

test("uses a deterministic idempotency fingerprint", () => {
  expect(legacyRowFingerprint("source", "target")).toBe(legacyRowFingerprint("source", "target"));
  expect(legacyRowFingerprint("source", null)).not.toBe(legacyRowFingerprint("source", ""));
});
