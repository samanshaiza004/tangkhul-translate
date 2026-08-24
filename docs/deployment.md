# Production deployment

## Target

The selected host is Fly.io Machines in `ord` (Chicago). It fits this application because it
runs one persistent Bun process, accepts arbitrary server-side secrets, supports outbound HTTPS
to Hugging Face and the Supabase session pooler, terminates HTTPS, performs HTTP health checks,
and provides an authoritative client address through `Fly-Client-IP`.

The committed [`Dockerfile`](../Dockerfile) is the production artifact. It uses the pinned Bun
runtime, frozen production dependencies, a non-root `bun` user, and copies no `.env`, Git
credentials, tests, exports, or database fixtures into the image.

The 512 MB shared-CPU machine is listed at approximately **$3.32/month** when continuously
running, before bandwidth and any optional services. Confirm current pricing before provisioning:
[Fly.io pricing](https://fly.io/docs/about/pricing/).

## First setup

Install and authenticate the Fly CLI, then create the application without deploying immediately:

```sh
fly auth login
fly launch --no-deploy
```

If the generated application name differs, update `app` in `fly.toml`; application names are
globally unique. Keep the region `ord` unless an operational decision changes it.

Set secrets only through Fly; never put them in this repository:

```sh
fly secrets set \
  NODE_ENV=production \
  DATABASE_URL='postgresql://...canonical-supabase-session-pooler...?sslmode=require' \
  HF_SPACE='chormi/byt5-tang-eng-frontend-demo' \
  HF_TIMEOUT_MS='180000'
```

Set `HF_TOKEN` only if the protected/private Space configuration requires it. Do not set
`SMOKE_PROVIDER` in production. `DATABASE_URL` must belong to canonical Supabase project
`zwkotkmmdxwbtmxyulff`, using the Supavisor session pooler on port 5432 when the host needs IPv4.

Apply migrations to the canonical database through an authenticated operator connection before
the first deploy:

```sh
DATABASE_URL='...canonical connection...' bun run db:migrate
```

Deploy and inspect the release:

```sh
fly deploy
fly status
fly logs
```

Fly routes the public HTTPS service to port 3000. The health check is `GET /readyz`; it will not
pass until the database and model/Space provenance invariants pass.

## Trusted client identity

The application uses `Fly-Client-IP`, which Fly documents as the address observed by Fly Proxy.
It ignores arbitrary `X-Forwarded-For` values. If another reverse proxy is added in front of Fly,
stop and redesign this resolver using that proxy's authenticated mechanism; do not simply trust a
new header. If Fly metadata is absent, the resolver falls back to Bun's raw socket address and
ultimately `unknown`, never a caller-supplied forwarding header.

Reference: [Fly request headers](https://fly.io/docs/networking/request-headers/).

## Release checks

Before directing a public domain to the service, verify:

```sh
curl -fsS https://<host>/healthz
curl -fsS https://<host>/readyz
```

Then inspect the response headers for HTTPS, CSP, `X-Content-Type-Options`, and `X-Request-ID`.
Perform one locked phrase translation and verify the persisted inference in canonical Postgres.
Run one correct verdict, one unclear verdict, and one correction; do not include these controlled
records in a training export.

Complete the browser/device checklist in [`production-verification.md`](production-verification.md)
against the deployed HTTPS host.

## Rollback

Keep the old Gradio frontend available during the initial soak period. If the Bun release is bad,
route the domain back to the old frontend and roll back the Fly release:

```sh
fly releases
fly releases rollback <known-good-version>
```

Do not change model weights, prompt, decoding settings, or the active model row as part of a web
rollback. Re-run `/readyz`, the smoke translation, and the Postgres provenance check after the
rollback.

## Operations

Observe HTTP errors, provider timeout/unavailable events, warm and cold-start latency, database
failures, and rate-limit events during the initial soak. Logs contain operational metadata only;
they must not contain Tangkhul text, model output, corrections, notes, raw IPs, passwords, or HF
tokens.
