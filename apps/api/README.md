# @arcula/api

The Arcula backend, on Bun (plan §3).

Phase 1 state:

- `src/main.ts` — the Phase 0 shell: a `serve` with one health endpoint
  (`GET /api/health` → `{"status":"ok"}`, anything else 501). The `serve`
  call is what stays; the handler is replaced as later phases mount the
  auth routes (Phase 2) and the domain API (Phase 3).
- `src/db.ts` — the single driver: postgres.js + drizzle over
  `@arcula/db`'s schema. Lazy connection; `DATABASE_URL` from the root
  `.env`.
- `src/auth.ts` — the Better Auth instance: `emailAndPassword` + `bearer`
  plugins, the drizzle adapter pointed at the schema, the four custom user
  columns declared in `user.additionalFields`, and
  `requireEmailVerification: false` as an **explicit** value (G6).
- `scripts/db-{migrate,reset,seed}.ts` + the `db:*` scripts (run from the
  root: `bun run db:reset`). `db:reset` is the Phase 1 exit criterion:
  drop all tables → re-apply migrations → clear both object prefixes
  (`staging/`, `artworks/`) in the S3 stand-in → seed the owner account
  through this package's own auth instance → sign back in through the
  adapter. It refuses to run in prod unless `ALLOW_DB_RESET=true`.
- `tests/adapter.test.ts` — asserts the `additionalFields` declaration and
  the schema's user table agree (the opaque sign-up gotcha, §5).

Two deliberate tsconfig choices:

- `types: ["bun"]` — the `Bun`/`serve` globals come from `@types/bun`.
- `lib: ["ES2022", "DOM"]` — Bun implements the web-platform globals
  (`fetch`, `Response`, `Headers`, `URL`, …), so the `DOM` lib is what types
  them here. The "no DOM lib" rule from `@arcula/shared` does **not** apply
  to this package: that rule protects the contract, which must hold under any
  runtime it is imported into. This package runs on Bun, full stop.

Run it with `cd apps/api && bun run dev` (watch mode, port 8000 by default —
the `PORT` in the root `.env` wins if set).
