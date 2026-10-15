# @arcula/shared

The client contract: everything the web app and the API must agree on, written
once. The wire types, the Zod schemas that validate the payloads they exchange,
the caps and the tier quota table both sides enforce, and the pure ordering and
slug helpers.

Nothing here may import from `apps/` — both sides consume this package, so a
dependency on either is a cycle. The only runtime dependency is `zod`, imported
directly by both sides (one version, pinned once).

The surface — `src/index.ts`, re-exported whole; importers use the bare package
name, never a subpath:

- `types.ts` — the wire types: `Timestamp`, `Artwork`, `ArtworkPhoto`,
  `ArtworkDocument`, `Collection`, `ImageVariant`.
- `schemas/` — the Zod schemas: `artwork`, `artworkImport`, `collection`,
  `document`, `user`.
- `caps.ts` — the per-file size caps and the accepted-type maps.
- `limits.ts` — `COLLECTION_LIMITS` and `collectionLimitForTier`, the per-tier
  collection quota the API enforces on create.
- `artworkPhotos.ts` — the photo-`order` invariant (`sortPhotos`,
  `reindexPhotos`) and the `photoUrl`/`photoSrcSet` ladder.
- `slug.ts` — `{urlizedName}-{id}` route params ⇄ bare ids.

Tests live in `tests/` and run with the repo's standard vitest setup
(`bun run test:shared` from the root). The suite is pure-logic by construction:
no DOM, no network.
