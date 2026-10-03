# @arcula/api

The Arcula backend, on Bun (plan §3).

In Phase 0 this package is a **shell**: `src/main.ts` is a `serve` with one
health endpoint (`GET /api/health` → `{"status":"ok"}`, anything else 501).
It exists so `bun run dev` runs the final two-process topology from the first
phase — and so the port, the boot, and the error shape are proven while the
repo is still small. Every later phase replaces the handler; the `serve` call
is what stays.

Two deliberate tsconfig choices:

- `types: ["bun"]` — the `Bun`/`serve` globals come from `@types/bun`.
- `lib: ["ES2022", "DOM"]` — Bun implements the web-platform globals
  (`fetch`, `Response`, `Headers`, `URL`, …), so the `DOM` lib is what types
  them here. The "no DOM lib" rule from `@arcula/shared` does **not** apply
  to this package: that rule protects the contract, which must hold under any
  runtime it is imported into. This package runs on Bun, full stop.

Run it with `cd apps/api && bun run dev` (watch mode, port 8000 by default —
the `PORT` in the root `.env` wins if set).
