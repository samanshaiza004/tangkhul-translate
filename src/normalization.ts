export const NORMALIZATION_VERSION = "n1";

const ZERO_WIDTH_SPACE = /\u200B/g;
const LEADING_BOM = /^\uFEFF/;
const SPACE_SEPARATORS = /\p{Zs}/gu;
const HORIZONTAL_WHITESPACE = /[ \t]+/g;
const EXCESS_NEWLINES = /\n{3,}/g;

export function normalizeSource(input: string): string {
  let normalized = input.normalize("NFC");

  normalized = normalized.replace(/\r\n?/g, "\n");

  // ZWJ and ZWNJ can carry orthographic meaning in Indic-script text.
  // Preserve them so distinct source strings remain distinct for hashing and
  // duplicate detection; only ZWSP and a true leading BOM are removed.
  normalized = normalized.replace(LEADING_BOM, "").replace(ZERO_WIDTH_SPACE, "");

  normalized = normalized
    .replace(SPACE_SEPARATORS, " ")
    .replace(HORIZONTAL_WHITESPACE, " ")
    .replace(EXCESS_NEWLINES, "\n\n");

  return normalized.trim();
}

export function sourceHash(input: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(normalizeSource(input));
  return hasher.digest("hex");
}
