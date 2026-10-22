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

- `types.ts` — the wire types: `Timestamp`, `Artwork`, `ArtworkStatus`,
  `Collection`, `CollectionRole`, `ArtworkPhoto`, `ArtworkDocument`,
  `ImageVariant`. `Collection` carries `role`/`ownerName` — the dashboard
  list's per-row extras, absent on every other read — and
  `isPasswordProtected`, the member read's one-bit answer about a password,
  derived from the hash's presence and never the hash itself, and absent on
  every anonymous read.
- `schemas/` — the Zod schemas: `access` (the access read, the transfer
  payload and its answer), `artwork`, `artworkImport`, `collection` —
  including `passwordSchema` for the settings write and
  `collectionUnlockSchema` for the unlock route's guess — `invitation`
  (create, summary, preview), `document`, `user`.
- `caps.ts` — the per-file size caps and the accepted-type maps.
- `limits.ts` — `COLLECTION_LIMITS` and `collectionLimitForTier`, the per-tier
  collection quota the API enforces on create. The quota counts owned
  collections only; a collaboration does not consume it.
- `email.ts` — `normalizeEmail`, the one trim-and-lowercase an address gets on
  both sides of every comparison.
- `invitationTime.ts` — the invitation clock: `INVITATION_TTL_MS` (seven
  days), `INVITATION_RESEND_COOLDOWN_MS` (one minute), `timestampMillis`, and
  the two questions the owner's access card asks of a row,
  `invitationLapsed` and `invitationResendWaitMs`.
- `artworkPhotos.ts` — the photo-`order` invariant (`sortPhotos`,
  `reindexPhotos`) and the `photoUrl`/`photoSrcSet` ladder.
- `slug.ts` — `{urlizedName}-{id}` route params ⇄ bare ids.

Sharing's contract is in the code too: `role`/`ownerName` on the dashboard rows,
the invitation loop's payloads, the access read, the resend, revoke and
collaborator-removal answers, and the transfer payload and answer the settings
card consumes. The design is in
[ADR-0004](../../docs/adr/0004-collections-are-shared-by-membership.md).

Tests live in `tests/` and run with the repo's standard vitest setup
(`bun run test:shared` from the root). The suite is pure-logic by construction:
no DOM, no network.
