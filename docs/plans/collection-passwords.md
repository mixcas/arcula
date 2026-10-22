# Plan: real password protection for collections

The design is [ADR-0005](../adr/0005-a-password-is-a-second-condition-on-a-public-collection.md).
This file is the working record: what ships, in what order, and how it is
proven. It is not a contract — the ADR is.

## What exists today (the gap being closed)

- `collections` has no password column. `packages/db/src/index.ts` says so in a
  comment, and `project-plan.md` lists password protection first under _What is
  not built_.
- `CollectionSettingsPage.tsx` already renders a `Require Password` switch and a
  `PasswordInput` (`:66-67`, `:267-286`) — orphaned from an earlier design, never
  sent in the update payload and never loaded from the collection.
- `usePublicCollection.ts`'s doc comment still refers to a "password prompt"
  that does not exist.
- There is no rate limiter anywhere in the product.

## The vocabulary this introduces

**Protected** and **Access grant**, both defined in
[GLOSSARY.md](../GLOSSARY.md).

## Release 1 — the schema, alone

Additive only. Nothing reads the new shape, so old code is unaffected and a
revert is safe.

**Migration `0005_collection_passwords` (generated, plus the two tables):**

- `collections.passwordHash text NULL` — nullable. No backfill, no `NOT NULL`
  step: a collection with no password is the normal state.
- `collection_access_grants(collectionId, tokenHash UNIQUE, createdAt,
expiresAt)` — with an index on `collectionId` so a password change can delete
  a collection's grants in one statement.
- The unlock throttle's counter table (per-IP fixed window).

**Why there is no third release.** `mediaNamespaceId` needed `0003` + `0004`
because it had to end up `NOT NULL` on an existing table, which cannot be done in
one step without breaking the old code's inserts. Nothing here must become
`NOT NULL`, so the sequence is two releases, not three, and Release 1 carries no
backfill.

**Done when:** the migration applies to a stack that predates it, `bun run check`
and the schema suite pass, and no route mentions the new columns.

## Release 2 — the feature

Ordered so each step is independently testable.

1. **`apps/api/src/collectionPassword.ts`** — pure module:
   `hashPassword` / `verifyPassword` over `node:crypto` `scrypt`, salt and
   parameters encoded as `scrypt$N$r$p$salt$hash`. Tier-1 tested directly.
2. **`collectionGrants.ts`** — pure facts beside `invitations.ts`: mint a
   32-byte token, hash it, and decide whether a row is usable (`expiresAt` in the
   future). Tier-1 tested.
3. **`access.ts`** — extend the verdicts to take the grant as a fact beside
   membership: `canSeeCollection(membership, collection, hasValidGrant)` and
   `canSeeArtwork(...)` likewise, with membership bypassing the challenge
   entirely. Extend the existing tier-1 tests; do not write a parallel suite.
4. **`authorize.ts`** — load the grant where it loads membership, so every read
   path keeps asking one question.
5. **Routes:**
   - `POST /collections/:collectionId/unlock` — verify the password, mint the
     grant, set the `HttpOnly`/`SameSite=Lax`/path-scoped cookie; `403
invalid-password` on a miss; `429` past the throttle window. The route shipped
     in #89 without the counting; #90 added it, over the counter table `0005`
     had already created, with the window's arithmetic in `unlockThrottle.ts`.
   - `PATCH /collections/:collectionId` — accept a password write on the
     settings path: set or overwrite the hash and delete the collection's grants
     in one transaction. Present-key semantics as the rest of the PATCH.
6. **`serialize.ts`** — derive `isPasswordProtected: boolean` from
   `passwordHash IS NOT NULL` and emit it on the **member read only**. The hash
   never leaves the server, and the anonymous read and the anonymous list do not
   carry the boolean at all.
7. **`collections.ts`** — the anonymous list filter becomes public **and not
   protected**; `requireReadableCollection` consults the extended verdict.
8. **`media.ts`** and **`artworkRead.ts`** — the photo path consults the
   extended verdict so the bytes are covered. Documents stay member-only.
9. **Shared contract** — `collectionUpdateSchema` gains the password write;
   `collectionReadSchema` / `Collection` gain optional `isPasswordProtected`;
   `passwordSchema` (the length rule) lives next to the other shared schemas.
10. **Web:**
    - `usePublicCollection.ts` gains the `locked` status in the union, and
      `publicCollectionState` gains its pure branch.
    - `PublicCollectionPage` renders the lock screen (app chrome, **not** a
      skin) and re-runs the load on success — the collection read stays
      sequenced before the artwork list.
    - `CollectionSettingsPage` — the orphaned switch becomes the three-state
      control from ADR-0005: fields when unset, "protected, stays in effect" with
      Reset/Remove when set, fields with Cancel while editing, nothing when
      private. Blank-and-untouched sends nothing. Confirm is client-side only
      and is never posted.
    - `collectionService` carries the unlock call.

## Test plan (altitude per AGENTS.md)

- **Tier 1:** `hashPassword`/`verifyPassword` round trip, salt and parameter
  encoding, wrong-password rejection; grant mint/hash/expiry; the extended
  `access.ts` verdict — the whole security decision, no DB, no server; the
  `publicCollectionState` locked branch as a pure fold.
- **API integration (real stack):** protected collection → anonymous list
  excludes it → collection read is refused without a grant → wrong password
  `403` → right password sets the cookie → the read succeeds → a photo byte
  succeeds with the grant and is refused without it → a password change revokes
  the outstanding grant.
- **Deleted/rewritten:** the orphaned settings UI has no test to delete; the
  `usePublicCollection` doc comment's stale "password prompt" reference goes.
- **Not written:** anything asserting a Mantine control exists. If a mutation to
  the lock screen would be invisible in review, it earns a tier-2 case; otherwise
  it is screenshots' job.

## Settled parameters

- **Cookie path and naming.** `Path=/api/v1`, one cookie per collection, named
  for the collection it admits (`arcula_grant_{collectionId}`), the value being
  the token. A cookie's `Path` is a prefix of the request path, so it cannot
  express "this collection": `/api/v1/media` serves every collection's bytes and
  there is no prefix that covers the reads and the proxy while excluding
  anything else. The broad path is therefore deliberate, and the **name** is the
  selector — a route already knows its collection id and looks up that name, so
  a cookie for another collection is simply never read. Scoping by name is what
  keeps the collections independent; scoping by path was never available.
- **Throttle.** A fixed 10-minute window, **10 failed attempts per IP per
  collection**, in Postgres: one upserted counter row per
  `(ip, collectionId, windowStart)`, the timestamp floored to the window. Only
  failures count and a success clears the counter, so a member who mistypes
  carries no debt. Keying on the pair rather than the IP alone keeps one
  collection's throttle from becoming a weapon against another's visitors
  through a shared address. The refusal is `429` and states the window, not the
  precise remaining time.
- **Password length.** A minimum of 8 characters, in a shared `passwordSchema`
  beside the other shared schemas so both sides enforce one rule.
- **The single-artwork route gets its own lock screen.** The artwork view
  follows the collection's rule: a non-member opening a work in a Protected
  collection is challenged, and the collection read stays the challenge point
  because it is already sequenced first.

## Documentation updates on completion

- `project-plan.md`: remove password protection from _What is not built_; add
  the feature, the two-release schema narrative, and the residual throttle
  weakness.
- `packages/db/README.md`: the `0005` migration and why it needs no tightening
  step.
- `AGENTS.md`: the `collections`/`access.ts` descriptions gain the challenge;
  the file is the working guide and currently says password protection is not
  built.
