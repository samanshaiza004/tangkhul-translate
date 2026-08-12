import { describe, expect, test } from "bun:test";

import { NORMALIZATION_VERSION, normalizeSource, sourceHash } from "../src/normalization";

describe("normalizeSource", () => {
  test("composes decomposed capital A with macron to precomposed Ā", () => {
    const precomposed = "\u0100";
    const decomposed = "A\u0304";

    expect(normalizeSource(decomposed)).toBe(precomposed);
    expect(normalizeSource(decomposed)).toBe(normalizeSource(precomposed));
  });

  test("composes decomposed lowercase a with macron to precomposed ā", () => {
    const precomposed = "\u0101";
    const decomposed = "a\u0304";

    expect(normalizeSource(decomposed)).toBe(precomposed);
    expect(normalizeSource(decomposed)).toBe(normalizeSource(precomposed));
  });

  test("keeps macron-below A distinct from precomposed macron A", () => {
    expect(sourceHash("A\u0331")).not.toBe(sourceHash("\u0100"));
  });

  test("keeps macron-below A distinct from plain A", () => {
    expect(sourceHash("A\u0331")).not.toBe(sourceHash("A"));
  });

  test("preserves case for macron-below characters", () => {
    expect(sourceHash("a\u0331")).not.toBe(sourceHash("A\u0331"));
  });

  test("documents the exact codepoints in the four-character diacritic matrix", () => {
    const capitalMacron = "Ā";
    const lowercaseMacron = "ā";
    const capitalMacronBelow = "A̱";
    const lowercaseMacronBelow = "a̱";

    expect(Array.from(capitalMacron)).toEqual(["\u0100"]);
    expect(Array.from(lowercaseMacron)).toEqual(["\u0101"]);
    expect(Array.from(capitalMacronBelow)).toEqual(["A", "\u0331"]);
    expect(Array.from(lowercaseMacronBelow)).toEqual(["a", "\u0331"]);
  });

  test("normalizes non-breaking spaces to plain spaces", () => {
    expect(normalizeSource("kha\u00A0lei")).toBe("kha lei");
    expect(normalizeSource("kha\u00A0lei")).toBe(normalizeSource("kha lei"));
  });

  test("removes zero-width spaces", () => {
    expect(normalizeSource("Tang\u200Bkhul")).toBe("Tangkhul");
  });

  test("preserves zero-width joiners in normalized output and hashes", () => {
    const withoutJoiner = "Tangkhul";
    const withJoiner = "Tang\u200Dkhul";

    expect(normalizeSource(withJoiner)).toBe(withJoiner);
    expect(sourceHash(withJoiner)).not.toBe(sourceHash(withoutJoiner));
  });

  test("preserves zero-width non-joiners in normalized output and hashes", () => {
    const withoutNonJoiner = "Tangkhul";
    const withNonJoiner = "Tang\u200Ckhul";

    expect(normalizeSource(withNonJoiner)).toBe(withNonJoiner);
    expect(sourceHash(withNonJoiner)).not.toBe(sourceHash(withoutNonJoiner));
  });

  test("strips a BOM only when it is the leading character", () => {
    expect(normalizeSource("\uFEFFTangkhul")).toBe("Tangkhul");
  });

  test("preserves an interior BOM", () => {
    const withInteriorBom = "Tang\uFEFFkhul";

    expect(normalizeSource(withInteriorBom)).toBe(withInteriorBom);
  });

  test("normalizes CRLF and lone CR line endings to LF", () => {
    expect(normalizeSource("line1\r\nline2")).toBe("line1\nline2");
    expect(normalizeSource("line1\rline2")).toBe("line1\nline2");
  });

  test("collapses consecutive spaces and tabs to one space", () => {
    expect(normalizeSource("Tang   \t \t khul")).toBe("Tang khul");
  });

  test("allows at most one blank line without removing paragraph breaks", () => {
    expect(normalizeSource("one\n\n\ntwo")).toBe("one\n\ntwo");
    expect(normalizeSource("one\n\n\n\n\ntwo")).toBe("one\n\ntwo");
    expect(normalizeSource("one\n\ntwo")).toBe("one\n\ntwo");
  });

  test("trims leading and trailing whitespace", () => {
    expect(normalizeSource("\n\t  Tangkhul English  \n\n")).toBe("Tangkhul English");
  });

  test("returns an empty string for empty and whitespace-only input", () => {
    expect(normalizeSource("")).toBe("");
    expect(normalizeSource("   \n\t  ")).toBe("");
  });

  test("preserves punctuation and mixed case", () => {
    const sentence = "Tangkhul, English—Both Stay! Is This Clear?";

    expect(normalizeSource(sentence)).toBe(sentence);
  });
});

describe("sourceHash", () => {
  test("returns a deterministic lowercase SHA-256 hex string", () => {
    const first = sourceHash("Tangkhul source");
    const second = sourceHash("Tangkhul source");

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });
});

test('NORMALIZATION_VERSION is exported as "n1"', () => {
  expect(NORMALIZATION_VERSION).toBe("n1");
});
