# @arcula/shared

The client contract: everything the web client and the API must agree on,
written once. Wire types, the Zod schemas that validate the payloads they
exchange, the caps the two sides enforce, the quota table, and the pure
ordering/slug helpers.

Nothing here may import from `apps/` — this package is consumed by both
sides, and a dependency on either one is a cycle. The only runtime
dependency is `zod`, which both sides import directly (G5: one version,
pinned once).

Two temporary seams, both reversed in Phase 4 of the API migration when
the wire shape lands:

- `src/types.ts` keeps a **type-only** import of `firebase/firestore` for
  the `Timestamp` annotation. Type-only: it is erased at build time, so it
  has no runtime or server footprint. When the API's wire shape lands, the
  annotation is replaced and the `firebase` devDependency goes with it.
- `src/schemas/artwork.ts` is the split core of the old web schema file.
  Its Firestore-flavoured comments are accurate for the client era it was
  written in and are rewritten storage-neutral in Phase 4, along with the
  web's `toArtworkUpdate` sentinel.

Tests live in `tests/` and run with the repo's standard vitest setup
(`bun run test:shared` from the root). The suite is pure-logic by
construction: no DOM, no Firestore, no network.
