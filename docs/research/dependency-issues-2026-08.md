# Dependency issue review — 2026-08-21

This note distinguishes problems observed while building Tangkhul Translate from upstream issues
that are merely adjacent or worth monitoring. Versions are the pinned versions in `package.json`
and the Hugging Face Space requirements used during Milestone 2.

## Observed in this project

### Hugging Face Transformers / Tokenizers dependency metadata

The copied Space failed to rebuild with `transformers==5.14.1` and `tokenizers==0.23.1` because
Transformers declared `tokenizers>=0.22.0,<=0.23.0`, while 0.23.1 is the available 0.23 release.
This was not a runtime model bug; it was an unsatisfiable dependency constraint. We fixed the
Space by pinning `tokenizers==0.22.2`.

Upstream issue: [transformers#47429](https://github.com/huggingface/transformers/issues/47429).
The issue contains the same reproduction and was later closed as stale; its comments do not prove
that the fix shipped. Treat the workaround pin as the reliable mitigation.

### htmx error-response swapping

This is a documented integration behavior rather than a defect in our app: htmx does not normally
swap error responses. It affected our requirement to keep HTTP 422/503/500 statuses while still
replacing the result fragment. We handled it in `public/app.js` with a narrow `htmx:beforeSwap`
allowlist instead of changing errors to HTTP 200.

Related upstream feature requests:

- [htmx#1619](https://github.com/bigskysoftware/htmx/issues/1619) — add error swapping to core
- [htmx#2509](https://github.com/bigskysoftware/htmx/issues/2509) — only enable swap for error targets

Both were open when reviewed.

## Relevant, but not observed in our runs

### Drizzle ORM + postgres.js prepared statements

Our exact pinned versions (`drizzle-orm==0.45.2`, `postgres==3.4.9`) have an open report that the
postgres.js adapter ignores client-level `prepare: true` for ordinary queries:
[drizzle-orm#6096](https://github.com/drizzle-team/drizzle-orm/issues/6096).

We did not observe a failure in the local tests or Supabase migration run, and the issue was filed
for Cloudflare Hyperdrive. It is nevertheless relevant because this application configures
`prepare: true`; re-check it before depending on server-side prepared-statement behavior as a
performance or compatibility guarantee.

### postgres.js + Supavisor transaction pooling

We did not use transaction pooling and did not reproduce a postgres.js failure. An open report
describes hung/deadlocked pools through Supavisor transaction mode:
[postgres#970](https://github.com/porsager/postgres/issues/970).

This supports the existing operational choice of the Supavisor session pooler, but is not evidence
of a bug in the session-pooler path used here.

### @gradio/client long-running jobs

We did not find a public issue that exactly reports “no ordinary per-`predict()` timeout.” The
client's `submit()` iterator and cancellation behavior required our own timeout race and reconnect
logic. The closest upstream request is [gradio#8368](https://github.com/gradio-app/gradio/issues/8368),
an open feature request for polling long-running tasks instead of holding a connection open. It is
adjacent, not a direct fix for our implementation.

## Not bugs in the libraries

- **Elysia:** the M3 `src/index.ts` composition-root wiring bug was ours. `app.handle()` is the
  documented in-process path and does not start the production process; no upstream Elysia bug was
  identified for this behavior. See the [Elysia testing documentation](https://elysiajs.com/patterns/unit-test).
- **@elysia/html, @kitajs/html, TypeScript, drizzle-kit, oxlint, oxfmt, Bun 1.3.14, and
  sentencepiece/torch:** no library bug was encountered in this project and no relevant public issue
  was identified during this review.
- **Bun:** an open issue reports a `Bun.spawn`/`bun test --isolate` regression in Bun 1.4.0,
  [oven-sh/bun#39852](https://github.com/oven-sh/bun/issues/39852). It explicitly reports Bun 1.3.14
  as passing, so it is not an issue we encountered; our project is pinned to the passing line.

MannerHTML is intentionally omitted from this review, per the question.
