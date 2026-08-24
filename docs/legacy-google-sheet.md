# Legacy Google Sheet migration

The historical Google Sheet is not trusted training data and is not a live application
dependency. Keep the original CSV export private unless its contents are known to be safe and
licensed for repository inclusion. After verification, make the source Sheet read-only and stop
all application writes to it.

Import a private CSV export with:

```sh
DATABASE_URL='...canonical or disposable operator connection...' \
  bun run legacy:import-sheet /private/path/legacy.csv
```

The importer accepts a `source` (or `tangkhul`) column and an optional `correction`, `translation`,
`english`, or `target` column. Cell text is preserved exactly after CSV parsing; no model output,
model revision, Space revision, or consent is invented. Every imported row is stored in the
`legacy_records` table with:

- `provenance = legacy_google_sheet`;
- `consent_version = legacy_or_unknown`;
- `verification_status = unverified`;
- a deterministic row fingerprint for idempotency.

Rows remain outside the normal feedback/review/export query. They cannot enter an accepted dataset
export automatically. A maintainer must define a separate, truthful migration path before any
legacy row can be used for another purpose.

The command reports rows read, imported, duplicates, invalid rows, and skipped rows. Re-running the
same CSV is safe: existing source/correction pairs are counted as duplicates and are not inserted
again. Verify the counts and sample exact text in Postgres before deleting or archiving the private
CSV.

