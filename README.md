# Tangkhul Translate

Tangkhul Translate is a Tangkhul-to-English translator built around a provenance-first data
pipeline: translate, record the exact inference, collect feedback, conduct maintainer review, and
produce versioned exports. See the project's MVP planning document for the full product
specification.

## Current status

This repository implements Milestones 1 through 4 plus the M4.1 hardening pass: a migration-managed schema, a working
Tangkhul-to-English translation flow, and public feedback capture. The browser posts only to Bun;
Bun calls the pinned Gradio endpoint and displays a translation only after the exact inference has
been stored. Every translation shown also carries feedback controls, described below. The maintainer
review CLI and deterministic dataset export are intentionally CLI-only; no reviewer web UI or
training automation is included.

## Setup

Install the pinned dependencies:

```sh
bun install
```

Copy `.env.example` to `.env` and fill in `DATABASE_URL`. The canonical production Supabase project
is `zwkotkmmdxwbtmxyulff`; the former `gblybekxtsbiciuzqhmu` project is retired/test history and
must not be used for deployment or exports. `HF_SPACE` defaults to the disposable
`chormi/byt5-tang-eng-frontend-demo` copy. The copy is currently public, so `HF_TOKEN` is optional;
if its visibility becomes private, configure a read token only on the Bun server. The original
protected `chormi/byt5-tang-eng` Space is a read-only parity baseline and must not be modified.
Use the database connection form appropriate for the environment:

- **Local development and CI:** Point at a disposable local Postgres instance. For example:

  ```sh
  docker run --rm -d -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
  ```

  Then set:

  ```dotenv
  DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres?sslmode=disable
  ```

- **Supabase:** Once the project is provisioned, use the **Supavisor session pooler** connection
  string on port 5432, such as a host named `aws-<region>.pooler.supabase.com`. Do not use the
  direct `db.<ref>.supabase.co` connection: it resolves to an IPv6-only address and commonly times
  out on IPv4-only home, office, and GitHub Actions networks. That failure can look like a firewall
  issue, but it is a DNS/connectivity mismatch.

  Never use the Supavisor transaction pooler on port 6543. It does not support prepared statements,
  which this app enables with `prepare: true` in `src/db.ts`.

Apply all committed migrations, then start the development server:

```sh
bun run db:migrate
bun run dev
```

The htmx browser file is already vendored and committed. Run `bun run vendor:htmx` only when the
installed `htmx.org` version changes.

## Translation parity

`tests/fixtures/translation-parity.json` records ten cases captured twice from the original
protected Space. Fixture creation aborts if the two exact outputs differ. The fixture distinguishes
authentic non-Bible phrases, Bible-derived phrases, and transport-only probes; it is never inserted
into application tables or treated as a training/benchmark dataset.

After changing the model Space, run `bun run parity:check`. This operational check calls the
configured copy through its named `/translate` endpoint and compares exact, untrimmed output plus
SHA-256. Add `HF_TOKEN` only if that copy is private. The check is intentionally outside the regular
unit-test suite.

Provider timeouts use Gradio `submit()`, race the job iterator against `HF_TIMEOUT_MS`, call
`job.cancel()`, and stop consuming the iterator. Connection or endpoint-schema failures invalidate
the cached client and reconnect once. HTTP 422, 503, and 500 remain error statuses; `public/app.js`
allows only marked translation fragments with those statuses to replace `#result`.

## Public feedback

Every successful translation shows three verdict controls: **Looks correct**, **Source unclear**,
and **Needs correction**. The first two record a lightweight signal (`feedback.status = "recorded"`)
and never enter review. **Needs correction** expands a form — prefilled with the exact model
output — for a corrected translation, optional issue tags, and an optional note; submitting it
creates a `pending_review` row. No public submission is ever auto-trusted: a correction only
becomes usable after a maintainer reviews it through the review CLI. At most one feedback
row exists per translation; a second submission for the same translation is rejected as a duplicate
without creating a second row.

Consent text is committed at `docs/consent/contribution-v1.md` and rendered verbatim inside the
correction form; `CONSENT_VERSION` in `src/consent.ts` is the single currently accepted version. The
hidden `consent_version` field submitted by the browser exists only to detect a stale page — the
server always stamps its own constant on the stored row, never the submitted value. A translation
page that predates a wording change is rejected with "Terms changed — reload the page and try
again," not silently accepted under the old terms. Because every translation is persisted
regardless of whether feedback is ever submitted, a separate storage notice sits beside the
Tangkhul input itself (not only inside the correction form), asking contributors to avoid private
or identifying text in anything they type.

`POST /translate` and `POST /feedback` share two `beforeHandle` guards, in this order:

1. **Cross-site rejection.** Requests missing the `HX-Request: true` header (which htmx sends
   automatically) or carrying `Sec-Fetch-Site: cross-site` are rejected with 403 before either
   touches the model or the database. This blocks forged writes from another origin.
2. **Rate limiting.** An in-memory token bucket per route (15/min for `/translate`, 30/min for
   `/feedback`), keyed by an HMAC of the caller's IP address using a secret generated fresh at
   process start. The raw address is never persisted, logged, or used directly as a map key. Buckets
   live only in process memory and are never written to Postgres. Limits are intentionally
   forgiving — mobile networks and NAT commonly put many contributors behind one address — and exist
   to blunt abuse of a public compute- and write-consuming endpoint, not to meaningfully throttle
   real usage. `src/app.tsx`'s `DEFAULT_RESOLVE_CLIENT_KEY` reads the address Bun observed on the
   raw TCP connection, which is correct only for a single instance with no reverse proxy in front;
   deploying behind a load balancer or CDN requires swapping in a resolver for whatever client-IP
   header that platform actually guarantees, never an arbitrary client-supplied
   `X-Forwarded-For`.

Guard order matters and is covered by a test: a forged request against an already-exhausted rate
limit still returns 403, not 429, because the cross-site check runs first.

## Migration runbook

For every schema change:

1. Edit `src/schema.ts`.
2. Run `bun run db:generate` to create a migration.
3. Review the generated SQL.
4. Commit the migration alongside the schema change.

Never use `drizzle-kit push`. It changes a database directly without producing the committed file
that describes the change, breaking the guarantee that a fresh database can be constructed from
migrations alone. CI validates schema changes by building a fresh database from committed
migrations, and this repository deliberately has no `db:push` script.

Run `bun run db:verify-fresh` to destructively rebuild the `public` schema from the full migration
set and verify the result. `TEST_DATABASE_URL` must point to a disposable local Postgres instance.
The script hard-refuses Supabase and all non-localhost hosts because it drops and recreates the
schema.

## Checks and CI

Run the complete local quality suite with:

```sh
bun run check
```

It runs TypeScript typechecking, linting, formatting verification, the JSX XSS scan, and all tests.
GitHub Actions runs those same checks and then applies the committed migrations to a genuinely
fresh, disposable Postgres 17 service container before running the tests. That
migration-from-scratch step proves the database needs no manual setup.

## Content Security Policy

The app uses a strict Content-Security-Policy: `script-src 'self'`, `style-src 'self'`, and no
`unsafe-inline` or `unsafe-eval`. Future htmx work must avoid `hx-on:*` attributes because they
evaluate inline JavaScript strings that this policy blocks. Do not add inline `<script>` or
`<style>` tags; keep interactivity in the vendored, self-hosted htmx file and any future external
`.js` or `.css` assets served from `/static/`.

## Operations

Free-tier Supabase projects pause after inactivity, commonly after roughly a week without traffic.
If `/readyz` unexpectedly returns 503 after a quiet period, check whether the Supabase project must
be manually resumed before diagnosing an application bug.

All seven public tables have RLS enabled with no policies and without `FORCE ROW LEVEL SECURITY`.
This gives Supabase Data API roles default-deny while the trusted table-owner connection continues
to work. The Supabase Data API should remain disabled because this application does not use REST,
GraphQL, or Supabase client libraries.

## Review and export

Maintainers run the review queue locally with a required stable identity:

```sh
REVIEWER_ID=saman bun run review
```

Accepted corrections can be exported as immutable, deterministic JSONL artifacts:

```sh
bun run dataset:export --version 2026-08-12
```

Exports use a repeatable-read database snapshot, fail closed on invalid review cardinality, apply
`data/benchmark-exclusions/v1.txt`, and never overwrite an existing version. If the database insert
fails after the artifact rename, the command reports an orphaned export and leaves it untouched for
explicit reconciliation. Startup and readiness also fail closed when `HF_SPACE` disagrees with the
active model provenance; production startup additionally verifies the deployed Space revision.

The permanent production-root smoke starts `src/index.ts` as a real process and uses a deterministic
provider stub:

```sh
bun run smoke:production-root
```

The live-provider smoke is manual and credential-gated:

```sh
bun run smoke:live
```
