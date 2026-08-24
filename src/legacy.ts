import { createHash } from "node:crypto";

export interface LegacyCsvRow {
  rowNumber: number;
  values: string[];
}

export class LegacyCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyCsvError";
  }
}

export function parseLegacyCsv(input: string): LegacyCsvRow[] {
  const rows: LegacyCsvRow[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let rowNumber = 1;
  let fieldStarted = false;

  const pushField = () => {
    fields.push(field);
    field = "";
    fieldStarted = false;
  };
  const pushRow = () => {
    pushField();
    if (fields.some((value) => value.length > 0)) rows.push({ rowNumber, values: fields });
    fields = [];
    rowNumber += 1;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (fieldStarted) throw new LegacyCsvError(`Unexpected quote on row ${rowNumber}.`);
      inQuotes = true;
      fieldStarted = true;
    } else if (character === ",") {
      pushField();
    } else if (character === "\n") {
      pushRow();
    } else if (character === "\r") {
      if (input[index + 1] === "\n") index += 1;
      pushRow();
    } else {
      field += character;
      fieldStarted = true;
    }
  }

  if (inQuotes) throw new LegacyCsvError(`Unclosed quote on row ${rowNumber}.`);
  if (fields.length > 0 || field.length > 0) pushRow();
  return rows;
}

export function legacyRowFingerprint(sourceRaw: string, correction: string | null): string {
  return createHash("sha256")
    .update(JSON.stringify([sourceRaw, correction]))
    .digest("hex");
}
