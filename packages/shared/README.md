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
  `Catalogue`, `CatalogueRole`, `CatalogueKind`, `ArtworkAvailability`,
  `ArtworkPhoto`, `ArtworkDocument`, `ImageVariant`. `Catalogue` carries
  `role`/`ownerName` — the dashboard
  list's per-row extras, absent on every other read — and
  `isPasswordProtected`, the member read's one-bit answer about a password,
  derived from the hash's presence and never the hash itself, and absent on
  every anonymous read.
- `schemas/` — the Zod schemas: `access` (the access read, the transfer
  payload and its answer), `artwork`, `artworkImport`, `catalogue` —
  including `passwordSchema` for the settings write and
  `catalogueUnlockSchema` for the unlock route's guess — `invitation`
  (create, summary, preview), `document`, `user`.
- `caps.ts` — the per-file size caps and the accepted-type maps.
- `limits.ts` — `CATALOGUE_LIMITS` and `catalogueLimitForTier`, the per-tier
  catalogue quota the API enforces on create. The quota counts owned
  catalogues only; a collaboration does not consume it.
- `pdfFallback.ts` — the Catalogue PDF fallback face's character rule:
  `pdfFallbackCharacters`, every distinct code point above U+007F in the drawn
  texts, ascending, and `pdfFallbackChunks`, that string split by code point at
  `MAX_PDF_FALLBACK_CODE_POINTS`. The web app sends the chunks and the API
  subsets the face from one, so the two sides cannot disagree about what the
  fallback must cover.
- `email.ts` — `normalizeEmail`, the one trim-and-lowercase an address gets on
  both sides of every comparison.
- `invitationTime.ts` — the invitation clock: `INVITATION_TTL_MS` (seven
  days), `INVITATION_RESEND_COOLDOWN_MS` (one minute), `timestampMillis`, and
  the two questions the owner's access card asks of a row,
  `invitationLapsed` and `invitationResendWaitMs`.
- `ids.ts` — the one id mint both sides use: `ID_LENGTH` (ten), the base62
  `ID_ALPHABET`, `MINTED_ID_SHAPE_RE` and `mintId`. Sampling is unbiased and
  throws rather than degrading when the platform has no secure source. Ids
  minted before this module keep their 32-character hex shape; both lengths
  coexist ([ADR-0007](../../docs/adr/0007-ids-are-ten-base62-characters.md)).
- `artworkFields.ts` — the Artwork fields registry: the togglable record keys,
  the two fixed ones (`title`, `artistName`), the per-Kind default map, and the
  `resolveArtworkFields`/`normaliseArtworkFields` pair the server that stores
  the deviations and the web app that renders the form both call.
- `artworkPhotos.ts` — the photo-`order` invariant (`sortPhotos`,
  `reindexPhotos`) and the `photoUrl`/`photoSrcSet` ladder.
- `artworkSearch.ts` — the ten-field Catalogue search predicate and its caps,
  the query suffix helper, and `normalizeSearchText`, the collapse Artist Name
  suggestions also use.
- `stagedUpload.ts` — the headers a staged presigned PUT signs: the list the
  media bucket's CORS rule must allow, read by path from `infra/cdk`'s test
  because that package is not a workspace member.
- `slug.ts` — `catalogueSlug`/`artworkSlug`, the `{urlizedName}-{id}` route
  params ⇄ bare ids.

Sharing's contract is in the code too: `role`/`ownerName` on the dashboard rows,
the invitation loop's payloads, the access read, the resend, revoke and
collaborator-removal answers, and the transfer payload and answer the settings
card consumes. The design is in
[ADR-0004](../../docs/adr/0004-collections-are-shared-by-membership.md).

Tests live in `tests/` and run with the repo's standard vitest setup
(`bun run test:shared` from the root). The suite is pure-logic by construction:
no DOM, no network.
