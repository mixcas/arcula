# API Migration Plan v3 — Firebase → Hono + Drizzle + PostgreSQL + S3 + Better Auth + Resend

> Status: **approved (2 Oct 2026); implementation-ready.**
>
> This is the final, authoritative migration plan. It supersedes the v1
> and v2 review drafts of this document. All claims about current
> behaviour were verified against the code, `AGENTS.md`, and
> `project-plan.md`; all claims about the failed first migration were
> verified against the `hono-api` branch; all claims about Better Auth and
> Porkbun were verified against current docs.
>
> Companion documents: `AGENTS.md` (current architecture doctrine),
> `project-plan.md` (current product plan — its "Planned: the beta release"
> is absorbed into Phase 5), `RENAME.md` (product is **Arcula**; the
> Firebase project `custodia-67307` still appears in internal identifiers),
> `API-MIGRATION-DEEPSEEK.md` (competing plan; its adopted items are folded
> in below and credited in §14).
>
> Baseline: the current working tree (branch `hono-api-ii`) is
> tree-identical to `main` — the clean Firebase app. The `hono-api` branch
> is the first, abandoned migration attempt; reference material only.
>
> Living document: update it when reality diverges; do not let it drift
> silently — that is how the first attempt died.

---

## 0.1 Ground rules

- **Monorepo**, bun workspaces. Everything — web client, API, shared
  contract, CDK — lives in this repository.
- **Assume an empty database.** No data migration, no Firebase-UID
  mapping. The current Firebase project contains test data only.
- **Our own `users` table.** We will start adding data to Users soon, and
  additions must be cheap: typed columns, not a bag (§0.3).
- **Wipe + seed must be one script.** Seeding is minimal: only creating
  an account for the owner with email/password.
- **Local: `bun run dev` runs the full stack.** **Deploy: AWS CDK.**
- **Future mobile clients** will connect to and consume the same API.
  The API is the product boundary; the web client is client #1.
- The current web client (`src/`) is **moved** (not copied) and adapted
  to call the new API instead of Firebase.

### Guiding principle

Keep the **client contract stable** and move the **work server-side.**
Every design decision was chosen to minimize the diff in the web client
and in the existing test suite, and to carry over the authz semantics
documented in `AGENTS.md` unchanged.

Second, from the meta-lesson of the first attempt (which had its own plan
documents and drifted from them anyway): **pin the contract tight enough
that an implementation cannot drift from it.** §3 is that pin, expressed
as guardrails over observed failures.

## 0.2 Locked decisions

All five open questions from v2 are now answered:

| #   | Decision                                                                              | Ruling                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Staging/promote for uncommitted uploads                                               | **Confirmed**                                                                                                                                                                                                                                                                                                                                    |
| 2   | Prod container runtime                                                                | **Bun everywhere.** Correction adopted: no official `bun:alpine` image exists — `oven/bun` is debian-based, and Sharp's prebuilt NAPI binaries are most proven on glibc. Container base is therefore **`oven/bun` (debian)**, which honors "use bun" with lower native-module risk. Local dev stays native Bun. WASM fallback unchanged (§13.1). |
| 3   | Dead `VITE_API_URL` / `VITE_USE_NEW_API` env vars (carryovers from the first attempt) | **Delete** — no dual-backend toggle                                                                                                                                                                                                                                                                                                              |
| 4   | Beta scope: `/signup`, `/manage/profile`, the one-collection cap                      | **In this migration**                                                                                                                                                                                                                                                                                                                            |
| 5   | Prod domain                                                                           | **You manage DNS (Porkbun); the deploy must not assume it.** Stack deploys HTTP-only until a cert ARN + domain are supplied. **Region: `us-east-1` (locked).** See §10.3                                                                                                                                                                         |

## 0.3 The user table — typed columns

The v2 `profile jsonb`-as-canonical-store decision is withdrawn. With
Drizzle + generated migrations, adding a typed column is a one-line
schema edit plus a generated migration — the "schema surgery" that
motivated the jsonb bag no longer exists. A jsonb bag as the _canonical_
user record gives up type safety, constraints, and queryability — exactly
what choosing Postgres/Drizzle buys — and makes tier/billing/filters
awkward.

Rule: **typed column for anything that is queried, validated, or
constrained** (`firstName`, `lastName`, `tier`; later `locale`/`currency`
when a feature needs them). **`settings` jsonb is reserved for genuinely
freeform preferences** that do not warrant their own column. Adding a
typed column later is one line + `db:migrate`.

Table naming: the Better Auth drizzle adapter expects its tables under
specific names — `user` (singular), `session`, `account`, `verification` —
and (verified) its generated pg schema uses `text` ids. The table is
therefore named **`user`** and extended through the documented
`additionalFields` path — which also fixes the v2 wobble of a table
called `users` while Better Auth models `user`.

---

## 1. Key design decisions

| Decision                              | Choice                                                                                                                                                                              | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API style                             | Plain JSON routes under `/api/v1`, resource-oriented, no RPC                                                                                                                        | Same resource model as the current service layer (`collectionService` / `artworkService`); trivial to consume from any client. `/api/v1` versioned; `/api/auth/*` and `/api/health` unversioned — auth is a fixed vocabulary (Better Auth defines its own endpoint paths) and does not need a version bar                                                                                                                                             |
| API response shapes                   | **Identical JSON to the Firestore documents** (`Artwork`, `ArtworkPhoto.variants[]`, `ArtworkDocument`, …)                                                                          | Client serializers, `photoUrl`/`photoSrcSet`, `sortPhotos`, the skins, and most component tests keep working with near-zero diff. The only shape change: `url` becomes a same-origin **proxy path**, not a Storage URL                                                                                                                                                                                                                                |
| Auth                                  | Better Auth `emailAndPassword`, mounted at `/api/auth/*`, cookie session; **`bearer` plugin wired in Phase 2**                                                                      | the Better Auth react client (`better-auth/react`) keeps the `useAuth()` contract; sign-up/reset are native endpoints — the `auth/requires-recent-login` re-authentication dance from `project-plan.md` §2 disappears. Verified gotcha (#6583): a bare `Authorization: Bearer` header does **not** resolve via `get_session` unless the `bearer` plugin is configured — wire it now (cheap) so the future mobile client authenticates without cookies |
| User table                            | **Typed columns on `user` + `settings` jsonb** (see §0.3)                                                                                                                           | "We will start adding data to Users soon" — with generated migrations, a typed column is a one-line edit. The bag form gives up type safety, constraints, and queryability                                                                                                                                                                                                                                                                            |
| IDs                                   | `text` (nanoid) everywhere, including Better Auth's tables                                                                                                                          | Matches the adapter's generated-schema convention (verified); ids are opaque strings in this codebase anyway; lowest-risk choice for the drizzle adapter                                                                                                                                                                                                                                                                                              |
| Thumbnails                            | **Server-side, Sharp.** Original uploaded once (presigned PUT); variants generated per photo in a `process` step                                                                    | The WebP-probe and the entire silent-downgrade class of bug _disappears_ — Sharp always encodes WebP. `variantSize`/`coverCrop` move verbatim; the never-upscale `fit: "inside"` rule is preserved; **EXIF orientation applied explicitly (`.rotate()`) before resize** — the current `imageRender.ts` does this, so it is preserved, not re-derived                                                                                                  |
| Image reads                           | **API proxy** (`GET /api/v1/media?key=…`), authz checked per request, stream from S3                                                                                                | Stable URLs that never expire (presigned GETs would break the `photoUrl` ladder on refresh); works identically for a mobile client; documents stay never-public because the proxy 403s non-owners                                                                                                                                                                                                                                                     |
| Extension story                       | Originals stored in their own format (keeps PNG alpha); variants `.webp`; PDFs as-is                                                                                                | Supersedes the client's probe / `extensionFor` machinery                                                                                                                                                                                                                                                                                                                                                                                              |
| CSV import                            | Client still parses + reviews in-browser (papaparse); **Confirm POSTs rows** to a batch endpoint; the server validates with the same shared Zod schema and inserts in a transaction | Preserves the entire review UX; the chunk-of-400 `writeBatch` semantics are replaced by one server-side transaction                                                                                                                                                                                                                                                                                                                                   |
| Authz                                 | Rules semantics re-implemented in the API service layer (`userId` owner checks, `isPublic`, `deletedAt == null`)                                                                    | The documented semantics of `firestore.rules` / `storage.rules` carry over 1:1 — they are _our_ logic, which the test doctrine says to keep testing                                                                                                                                                                                                                                                                                                   |
| Collection cap (`project-plan.md` §1) | **Enforced in the API:** `count < COLLECTION_LIMITS[tier]` on create; the map `COLLECTION_LIMITS: Record<tier, number>` lives in `packages/shared` (beta: `free → 1`)               | Postgres can count; the whole "Firestore rules can't count documents" problem vanishes. The map keyed by tier is what `project-plan.md` §1 always wanted ("a `COLLECTION_LIMITS` map keyed by tier") — now literally implementable                                                                                                                                                                                                                    |
| Migrations machinery                  | **Deleted.** Drizzle migrations + the empty-DB assumption make `MigrationsPage`, `src/migrations/*`, and `maintenanceAccess` obsolete                                               | The doctrine they existed for (backfilling legacy documents) no longer applies                                                                                                                                                                                                                                                                                                                                                                        |
| Email                                 | Provider interface: `MailpitEmail` (local) / `ResendEmail` (prod), wired into Better Auth's `sendResetPassword` / `sendVerificationEmail` config hooks                              | Nothing local bills; prod uses Resend exactly as requested                                                                                                                                                                                                                                                                                                                                                                                            |

### Notes on deletions

`functions/` is a dead scaffold — it exports nothing and nothing in `src/`
calls or depends on it at runtime. Its only content is a design note for
password-protected collections (FULLSPEC §9), which is preserved as
optional Phase 8.

The `VITE_API_URL` / `VITE_USE_NEW_API` variables sitting in `.env`
(currently referenced by nothing in the code — carryovers from the first
attempt): **deleted.** The service-layer swap _is_ the cutover; a
dual-backend kill switch would mean maintaining two data layers for the
duration of the migration.

## 2. Repository layout

```
arcula/
├── package.json            # bun workspaces: ["apps/*", "packages/*"]
│                           #   root scripts: dev, stack:*, check, test, db:*, deploy
├── bun.lock
├── docker-compose.yml      # local: postgres only (S3 stand-in + mailpit run natively — §15)
├── scripts/                # stack-up.sh / stack-down.sh (the mixed local stack, §15)
├── apps/
│   ├── web/               # React 19 + Vite + TS + Mantine — current src/
│   │   ├── src/          #   moved here (not copied)
│   │   ├── tests/        #   current tests/ moved + ported
│   │   └── vite.config.ts#   + server.proxy['/api'] → VITE_API_TARGET
│   └── api/             # Hono + Better Auth + Drizzle, on Bun
│       ├── src/         #   main.ts, app.ts, db/, auth/, routes/,
│       │                #   services/, media/, email/
│       ├── scripts/     #   db-migrate / db-reset (wipe+seed) / db-seed (§4)
│       └── package.json #   db:reset, db:seed, db:migrate, db:studio scripts
├── packages/
│   ├── db/             # Drizzle schema (all tables, §4) + generated
│   │                   #   migrations; imported by api, seed, and tests
│   └── shared/         # client contract: types, Zod schemas, slug,
│                       #   caps, sortPhotos/reindexPhotos,
│                       #   photoUrl/photoSrcSet, COLLECTION_LIMITS
└── infra/
    └── cdk/          # AWS CDK TypeScript app (§10)
```

- **Moved, not copied.** `src/` becomes `apps/web/src/` and `tests/` becomes
  `apps/web/tests/` — done with `git mv` so history survives. No
  Firebase-specific code in `apps/web/src` survives Phase 7: the Firebase
  service layer is **deleted**, not shimmed.
- **`packages/db` is framework-agnostic.** The seed script runs in the
  **api** package (it must hash the seed password through the same Better
  Auth `signUp` instance the app signs in with, §4/§9), and both import the
  schema from `packages/db` — one schema, no drift. `db:migrate` applies the
  migrations that file generated.
- **`packages/shared` is the client contract.** Everything a _client_
  (web today, mobile tomorrow) must agree with the server: the data types,
  the Zod schemas, `slug`/`urlize`, the caps, `COLLECTION_LIMITS`, the
  photo-order helpers (`sortPhotos`/`reindexPhotos`), and the `photoUrl` /
  `photoSrcSet` ladder. Server and every client import it; nothing in
  `shared` may import from `apps/*` (no cycles).
- **The geometry stays in `apps/api`.** `variantSize`/`coverCrop` describe
  _how the server_ resizes; no client calls them, so they stay in the api —
  with a documented move trigger: if a second client ever needs them (mobile
  generating variants client-side), they move to `packages/shared`.
- **`seed` runs in the `api` package.** The same-instance reason above.
  `db:reset` (wipe) and `db:seed` are local-only scripts; `db:reset`
  **refuses to run in prod** unless `ALLOW_DB_RESET=true`.
- **`infra/cdk`** is standalone TypeScript; the CDK constructs never import
  application code (secrets are looked up by name, not value).
- **Naming [Phase 0, 3 Oct 2026].** The new packages are born `@arcula/*`
  — `@arcula/web`, `@arcula/shared`, `@arcula/db`, `@arcula/api` — and the
  root package is named `arcula`. The web app's own package name moves with
  them (`custodia` → `@arcula/web`), pulled forward from Phase 7 at the
  owner's ruling: a private identifier with no runtime effect (RENAME.md).
  The Firebase project id and the `demo-custodia` emulator project are
  untouched.

## 3. Known failure modes — guardrails

The `hono-api` branch (first attempt) is the empirical record of what breaks
when a plan drifts. Each observed failure becomes a guardrail in this plan;
an implementation that trips one is _wrong_, by definition — it repeated a
known failure.

| #   | Observed failure (verified on `hono-api`)                                                                                                                                                                            | Guardrail in this plan                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Two parallel data paths (Firebase + API) left behind the dead `VITE_USE_NEW_API` toggle — the shipped app was **two half-apps** coexisting, and no test could see the cutover because each half passed its own suite | One data path per service. **No dual-backend toggle** (§0.2 #3): the service-layer swap _is_ the cutover, and the dead env vars are deleted, not defaulted                                                                    |
| G2  | The Drizzle schema carried **invented fields** that exist in no current code path — the schema described an imagined data model                                                                                      | The schema is derived **field-by-field from `src/types/index.ts`** (plus the Better Auth core tables, §4). Every column must trace to a current field, a Better Auth core field, or an explicit `project-plan.md` requirement |
| G3  | `urlizedName` and even **full URLs** were stored as document fields/ids instead of the established `{urlizedName}-{id}` route convention                                                                             | Ids are `text`/nanoid everywhere; the route pattern is fixed in the API surface (§7); `slug`/`urlize` live in `packages/shared` with exactly one implementation                                                               |
| G4  | The variant pipeline was re-derived from memory and **dropped the EXIF-orientation handling (`.rotate()`) that the current `imageRender.ts` applies** — vertically-oriented phone photos render rotated              | Geometry **moves verbatim** from `src/utils/imageVariants.ts` into the api, `.rotate()` included explicitly; the variant tests keep their orientation assertions, so the regression is caught at CI time                      |
| G5  | **Zod 3 and v4 were mixed** in one repo — schemas validated with different major versions in different places, with no error to show for it                                                                          | **Zod v4 everywhere**, pinned once; a `v4`-vs-`v3` import anywhere fails `check`                                                                                                                                              |
| G6  | `requireEmailVerification: false` in the auth config — verification silently disabled while the product plan (and reset-password semantics) assume verified accounts                                                 | Verification is **built-but-gated** (§5): the column, the hook, and the config switch all exist from Phase 2; enabling in beta is a config flag, not a schema change                                                          |
| G7  | `orderStart = max ?? 0` — with 0-based order, an _empty_ list has no max, so `?? 0` makes the first uploaded photo **order 1**, silently breaking the "index 0 is the primary thumbnail" invariant                   | `max ?? -1` (and `max ?? -1` for documents if they ever gain order). Test-asserted: the first upload of a fresh artwork is order 0                                                                                            |
| G8  | Tests mocked the data layer (MSW) and passed against a **mock that the real API would fail** — the suite green-lit a broken app                                                                                      | **No MSW, no stubbed data layer** (§11): component tests render against the proxied local API where practical; where a mock is unavoidable it mocks the _contract_ (the shared Zod schemas), never an imagined one            |

## 4. Database schema

Nine tables: four Better Auth core tables (extended), five domain tables.
Everything else in the current Firestore model is either a relation between
these tables (no denormalized id arrays) or a derivable value (object paths,
defaulted fields).

### `user` [changed in v3 — see §0.3]

| Column                    | Type                             | Notes                                                                                               |
| ------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `id`                      | text, PK                         | nanoid; the adapter's convention                                                                    |
| `email`                   | text, NOT NULL, unique           | core                                                                                                |
| `name`                    | text, nullable                   | core; the seed writes it (`SEED_NAME`)                                                              |
| `emailVerified`           | boolean, default `false`         | core; the verification switch of §5                                                                 |
| `image`                   | text, nullable                   | core; the avatar — deferred to Phase 8                                                              |
| `firstName`               | text, nullable                   | **custom** (`additionalFields`, Zod-typed)                                                          |
| `lastName`                | text, nullable                   | **custom**                                                                                          |
| `tier`                    | text, NOT NULL, default `'free'` | **custom** — the quota/cap key (`COLLECTION_LIMITS`)                                                |
| `settings`                | jsonb, nullable                  | **custom** — the one sanctioned freeform bag; left empty until a genuine freeform preference exists |
| `createdAt` / `updatedAt` | timestamptz                      | core                                                                                                |

### Core tables (adapter-generated; keep the generated shape, don't hand-roll)

- **`session`** — `id`, `userId` (→ `user`), `expiresAt`, `createdAt`, `updatedAt`.
- **`account`** — `id`, `userId`, `providerId`, `accountId`, the credential/token fields, `createdAt`, `updatedAt`: the 1.7.7 core model, exactly — no `method`/`type` columns (§15). The adapter schema-checks this table at construction, so a deviation is a hard `SchemaMismatchError`, not a silent one.
- **`verification`** — `id`, `identifier`, `value`, `expiresAt`, `createdAt`, `updatedAt`. **Defined in the schema even though verification is gated off in beta** — that is what makes the later enablement a config flip, not a schema change (G6).

### `collections`

| Column                    | Type                              | Notes                                                                                                                             |
| ------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | text, PK                          |                                                                                                                                   |
| `userId`                  | text, NOT NULL, index             | the ownership filter                                                                                                              |
| `name`                    | text, NOT NULL                    |                                                                                                                                   |
| `description`             | text, nullable                    |                                                                                                                                   |
| `isPublic`                | boolean, NOT NULL, default `true` | every write path keeps the public default                                                                                         |
| `skin`                    | text, nullable                    | read-time default `DEFAULT_SKIN_ID`; **never queried**, so no backfill was ever needed (the deliberate contrast with `deletedAt`) |
| `skinOptions`             | jsonb, nullable                   | validated at read time against the skin's `options` spec; unknown keys dropped                                                    |
| `createdAt` / `updatedAt` | timestamptz                       |                                                                                                                                   |

The Firestore document's `artworks: string[]` and `passwordHash?` fields do
**not** become columns: the former is a denormalized list that a join replaces
(G2), and the latter is dead — if Phase 8 builds password-protected
collections, its column is added then, as a typed column.

### `artworks`

| Column                                                                                                                                                         | Type                              | Notes                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                                                                                                           | text, PK                          |                                                                                                                                               |
| `userId`                                                                                                                                                       | text, NOT NULL                    | owner                                                                                                                                         |
| `collectionId`                                                                                                                                                 | text, NOT NULL, index             | parent                                                                                                                                        |
| `title`                                                                                                                                                        | text, NOT NULL                    |                                                                                                                                               |
| `artistName`                                                                                                                                                   | text, NOT NULL                    |                                                                                                                                               |
| `serie` / `dateOfCreation` / `media` / `dimensions` / `editions` / `acquisitionDate` / `placeOfOrigin` / `provenance` / `notes` / `condition` / `currentValue` | text, nullable                    | the full current field list, **field-for-field** from `src/types/index.ts`; money stays **text** (the string that was typed — no float drift) |
| `isPublic`                                                                                                                                                     | boolean, NOT NULL, default `true` | per-artwork, independent of the collection's flag                                                                                             |
| `deletedAt`                                                                                                                                                    | timestamptz, nullable             | **`NULL` = live.** Soft delete stays; the column replaces the Firestore field                                                                 |
| `createdAt` / `updatedAt`                                                                                                                                      | timestamptz                       |                                                                                                                                               |

There are **no `photos` / `documents` array columns** — those are tables.

### `artwork_photos`

| Column      | Type                  | Notes                                                                                                                           |
| ----------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | text, PK              |                                                                                                                                 |
| `artworkId` | text, NOT NULL, index |                                                                                                                                 |
| `order`     | integer, NOT NULL     | 0-based; **UNIQUE (artworkId, order)** — the "array position is the truth" invariant becomes a constraint the database enforces |
| `name`      | text, NOT NULL        | the original filename; metadata only, never in an object path                                                                   |

### `artwork_photo_variants` (v2 name; serves both populations)

| Column             | Type                                    | Notes                                                                                           |
| ------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `parentKind`       | text, CHECK (`'photo'` \| `'document'`) | one variants table for photo variants **and** image-document variants                           |
| `parentId`         | text, NOT NULL                          | → `artwork_photos.id` or `artwork_documents.id`                                                 |
| `key`              | text, NOT NULL                          | `'original'` + the `IMAGE_VARIANTS` keys (photo: all five; document: `square_sm`, `large` only) |
| `width` / `height` | integer                                 | **actual encoded pixels**, not nominal                                                          |
| `size`             | integer                                 | bytes                                                                                           |
| `contentType`      | text                                    | recorded, not assumed                                                                           |

PK is **(`parentId`, `key`)** — there is no separate `id`: a given parent can
have at most one object per key, which is exactly what makes promote-at-save
an idempotent `COPY`.

### `artwork_documents`

| Column                 | Type                                | Notes                                   |
| ---------------------- | ----------------------------------- | --------------------------------------- |
| `id`                   | text, PK                            |                                         |
| `artworkId`            | text, NOT NULL, index               |                                         |
| `kind`                 | text, CHECK (`'file'` \| `'image'`) | the discriminated union becomes a CHECK |
| `name`                 | text, NOT NULL                      | the user's original filename, preserved |
| `size` / `contentType` | integer / text                      | the source, for both kinds              |
| `width` / `height`     | integer, nullable                   | set only when `kind = 'image'`          |

**No `order` column** — there is no sequence and no primary thumbnail for
documents, so there is nothing for an index to mean.

### Indexes

| Index                                          | Serves                                                       |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `collections (userId)`                         | the owner's collection list                                  |
| `artworks (collectionId, userId, deletedAt)`   | owner list — the Firestore composite, now a plain column     |
| `artworks (collectionId, isPublic, deletedAt)` | visitor list                                                 |
| `artworks (collectionId)`                      | the artwork-by-id-in-collection check (create authorization) |
| `artwork_photos (artworkId, order)` (unique)   | the order invariant                                          |
| `artwork_photo_variants (parentId, key)` (PK)  | variant lookup + idempotent promote                          |
| `artwork_documents (artworkId)`                | the document list                                            |

Composite indexes are ordinary in Postgres; the Firestore composite-index
ceremony (`firestore.indexes.json`, deploy-gating) disappears.

### Response serialization

The service layer rehydrates the **exact Firestore document shapes**
(`Collection`, `Artwork`, `ArtworkPhoto`, `ArtworkDocument`) from rows, so
client serializers and `photoUrl`/`photoSrcSet` keep working unchanged:

- `Collection`: row as-is, with read-time defaults (`skin → DEFAULT_SKIN_ID`,
  `skinOptions` validated and defaulted).
- `Artwork`: row as-is, `photos`/`documents` joined in.
- **`url` is derived, never stored.** An object's path is a pure function of
  `(userId, collectionId, artworkId, entryId, key, extension(contentType))`
  — the same `objectName()` the current `artworkFiles.ts` computes. The
  serializer fills each `original.url` / `variant.url` with the **same-origin
  proxy path** for that object, so `photoUrl`'s ladder falls through
  `xlarge → large → … → original` exactly as it does today.
- `ArtworkPhoto.original` comes from the row's `key = 'original'` variant row;
  `ArtworkDocument` image variants come from the same variants table.

### Wipe + seed (one script)

`db:reset` (local only — refuses in prod unless `ALLOW_DB_RESET=true`):
drop all tables → re-apply migrations → **clear both object prefixes**
(`…/staging/…` and final) in SeaweedFS → seed. Seeding is minimal:
`signUp.email({ email: SEED_EMAIL, password: SEED_PASSWORD, name: SEED_NAME })`
through the **same Better Auth instance** the app signs in with, so the stored
hash is compatible with real sign-in. `firstName`/`lastName` stay null until
the profile page is used.

`db:studio` opens Drizzle Studio against the local DB. In this registry the
Studio ships as the `drizzle-kit studio` subcommand (beta) rather than as a
standalone package (§15).

## 5. Auth

- **Instance.** `betterAuth` configured with the **`emailAndPassword`** and
  **`bearer`** plugins; the four core tables + the custom `user` columns are
  declared through the adapter's `additionalFields` (Zod-typed: `firstName`,
  `lastName`, `tier`, `settings`) and `includeFields` (all four returned in
  session responses). **Undeclared custom columns are the known gotcha** —
  sign-up then fails opaquely — so the declaration and the schema columns are
  asserted in the Phase 1 tests, not assumed.
- **Mount.** The framework-agnostic fetch handler — `auth.handler` in
  1.7.7; the `toWebHandler` name from earlier docs does not exist in its
  exports — is mounted on the Hono app at **`/api/auth/*`** — `signUp`,
  `signIn`, `signOut`,
  `changePassword`, `resetPassword`, `requestVerification`, `verifyEmail`,
  `getSession` all under that prefix.
- **Session cookie.** httpOnly, `sameSite: lax`; **`secure: true` in prod**
  (flipped by the prod config, §10.3). With the `bearer` plugin wired, the
  same instance also resolves **`Authorization: Bearer <session>`** — that is
  what the future mobile client will use, and it is wired in Phase 2 (cheap
  now, painful later).
- **Custom fields.** `PATCH`-able through the profile endpoint (below);
  anything else on the row is server-managed.
- **Email.** Provider interface over the `sendResetPassword` /
  `sendVerificationEmail` hooks: **Mailpit** locally (compose), **Resend** in
  prod. Nothing local bills.
- **Verification — built but gated off in beta.** The column exists, the
  hooks exist, `requireEmailVerification` is an **explicit config value** (G6:
  it must never be a silently-baked-in `false`). Beta signs in without
  verified email; enabling verification later is a config flip.
- **Reset — fully live in beta.**
- **Seed.** As in §4 — `signUp.email({ email, password, name: SEED_NAME })`.
- **Profile (Phase 5, `project-plan.md` §2):**
  - `GET /api/v1/me` — the session user, serialized with the custom fields.
  - `PATCH /api/v1/me` — **writable set `{ firstName, lastName, settings }`**;
    a patch touching anything else (`tier`, `email`, …) is rejected with a
    dedicated error code, `field-not-writable`. This is the typed-column
    equivalent of the old rules `hasOnly(…)` clause — the "you may edit your
    own document" trap, now enforced by schema instead of rules expression.
  - `POST /api/auth/change-password` — native.
  - **Email change stays out of scope** (needs verify-before-update +
    confirmation email — a different decision).
- **Client.** The Better Auth react client — the `better-auth/react`
  subpath of the main package in 1.7.7; there is no standalone
  `@better-auth/react` (the web app pins `better-auth@1.7.7`, the API's
  version) — keeps the `useAuth()` contract in the web
  client; session rides the cookie (web) or the bearer header (mobile).

## 6. Storage + media pipeline

The client-side generation pipeline (`imageWorker` / `imageProcessing` /
the WebP probe and its silent-downgrade class of bug) is **retired**.
Generation happens server-side, once, with Sharp — Sharp always encodes
WebP, so there is no capability probe to get wrong.

**Why the v1 shape (upload N objects per photo, client-generated) is
withdrawn.** It pushed N× the storage writes, N× the rule surface, and the
entire probe machinery onto the client, and it committed objects to their
final keys before the form was saved — a cancelled form then left N live
objects pointing at nothing.

**Object keys.** Two prefixes, both flat, both self-describing (the id
segments are what make an object identifiable in the console and sweepable
by prefix):

```
final:    artworks/{userId}/{collectionId}/{artworkId}/photos/{entryId}_{key}.{ext}
          artworks/{userId}/{collectionId}/{artworkId}/documents/{entryId}_{key}.{ext}
staging:  staging/{userId}/{collectionId}/{artworkId}/{entryId}[_{key}].{ext}
```

- **`staging/` leads the staged key, not trailing it** [v3 fix].
  Storage lifecycle rules match _literal key prefixes_, and the v2 nested
  form has no constant one — `userId`/`collectionId`/`artworkId` all vary,
  so no rule can address "all staged objects" under it. With `staging/`
  leading, **one rule with prefix `staging/` covers every staged object in
  every collection**, in MinIO and in S3 alike. Final keys keep the nested
  form on purpose: nothing ever needs a prefix rule over final objects —
  orphans are swept explicitly (§6 residual).

- **`staging/`** holds everything until save. The row for an entry exists
  only once the save commits — uncommitted uploads are staged objects, and
  that distinction is what makes save atomic-feeling.
- **Promote = `CopyObject` at save** (staged key → final key), then the
  staged object is deleted. Copy is idempotent per (`entryId`, `key`)
  because the variants-table PK is (`parentId`, `key`).
- **7-day lifecycle on the `staging/` prefix** (CDK `LifecycleRule` in prod)
  is the safety net for abandoned uploads: a staged object with no save
  self-destructs. Locally the lifecycle is not relied on — `db:reset`
  clears both prefixes, which is stronger. (If it is ever needed locally,
  SeaweedFS lifecycle support is to be verified then, not assumed.)
- **Extension** never comes from the request: originals keep their source
  format (PNG stays PNG — alpha), variants are `.webp`, document PDFs are
  `.pdf`. `contentType` is recorded per object and the extension is a pure
  function of it (`extensionFor`) — the forgeable-`contentType` trap is
  handled the same way the old client's allowlist was: the **name** is what
  the rules/proxy bind to, and the allowlist stays an XSS control (SVG/HTML
  are accepted nowhere).

**The flow (four steps).**

1. **Stage.** Client mints `entryId` (nanoid — the same convention the
   current client uses) and `POST`s the original as multipart
   (`{ entryId, file }`) to `…/stage` [v4, S7: was a presigned PUT in v3].
   The body rides the session cookie (or Bearer), so the server validates
   type + size **as the upload arrives**: photos `image/*` ≤ 10 MiB;
   documents `image/*` | `application/pdf` ≤ 25 MiB. No presign, no second
   round trip — the session the form is already using is the credential.
2. **Process.** `POST …/process { entryId }`: server reads the staged
   original, decodes with Sharp, **applies EXIF orientation (`.rotate()`)
   before any resize** (G4 — the current `imageRender.ts` does this and it
   is preserved, not re-derived), generates the variant set (photos: all
   five keys, geometry verbatim from `IMAGE_VARIANTS`; document images:
   `square_sm`, `large` only), writes each to `staging/`, and returns the
   metadata — `width`/`height`/`size`/`contentType` per key. The form
   renders previews **from that response**, so the browser never encodes
   anything.
3. **Save.** One `POST`/`PATCH` per artwork carrying the staged
   `entryId`s + `order` + the form fields. Server work in **one
   transaction**: validate (shared Zod schemas) → insert/update the artwork
   row (cap check on create, §1) → for each entry: `COPY` staged → final,
   insert photo/document row + variant rows, reindex `order` → delete the
   staged objects. Nothing is committed until the whole save validates —
   a failed save commits nothing, and the staged objects it leaves behind
   are exactly what sweep and lifecycle exist to remove.
4. **Sweep.** `POST …/maintenance/sweep` (owner): delete staged objects
   whose `entryId` has no live row. Called automatically by `db:reset`
   (local) and available as a manual endpoint (prod safety net; the
   lifecycle is the automatic one).

**Known accepted residual.** A save that fails _after_ some copies have
already landed — and the user then abandons the form — leaves **final-prefix
objects with no row**, which the staging lifecycle cannot reach (they are no
longer staged). Accepted in beta: they are invisible (nothing references
them) and bounded (abandoned saves). Mitigation: the optional
`POST …/maintenance/sweep-orphans` (Phase 8) that deletes final objects
whose (`entryId`, `key`) matches no row.

**Reads — the proxy.** `GET /api/v1/media?key={objectKey}`; the key is
parsed back into its segments (the name is self-describing by construction)
and authz is checked per request, then the object streams:

| Object             | Who may read it                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| photo (any key)    | the owner, **or** a visitor iff `artwork.isPublic && collection.isPublic && artwork.deletedAt == null` — the storage-rules visitor rule, mirrored      |
| document (any key) | **the owner only.** Documents are never public; the proxy 403s everyone else, so a future UI that forgot to hide them renders a 403 rather than a leak |

404 for a key that does not parse, names no row, or names no object;
`Content-Type`/`Content-Length`/`Cache-Control` set from the stored row.

**Order.** 0-based; `orderStart = max ?? -1` (G7); `reindexPhotos` on every
write; the `UNIQUE (artworkId, order)` constraint makes a duplicate or
gap a database error instead of a silent drift. **Documents have no
order** (§4) — the invariant does not apply to them.

**Decision point (Phase 3, re-evaluated with real timings).** The pipeline
runs **synchronously in the request** — no queue, no 202, no polling.
That holds while **p95 per-photo processing ≤ ~3 s** and a **10-photo save
≤ ~15 s** on the deployment target. If either is exceeded, revisit with a
queue (pg-boss) + async endpoints — the staging design means the switch
changes the _transport_, not the data model or the client contract.

## 7. API surface

`/api/v1` for the resource API; `/api/auth/*` and `/api/health` unversioned
(§1). GET responses are **the exact Firestore document shapes** (§1), with
`url` fields filled with proxy paths — so client serializers are untouched.

| Route                                                                                                              | Method      | Auth                                                                                                                                                                                        | Purpose                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/health`                                                                                                      | GET         | —                                                                                                                                                                                           | liveness                                                                                                                                               |
| `/api/auth/{signUp, signIn, signOut, changePassword, resetPassword, requestVerification, verifyEmail, getSession}` | POST        | —                                                                                                                                                                                           | Better Auth, native (§5)                                                                                                                               |
| `/api/v1/me`                                                                                                       | GET / PATCH | session                                                                                                                                                                                     | profile: GET = the session user incl. custom fields; PATCH writable set `{ firstName, lastName, settings }`, anything else → `field-not-writable` (v3) |
| `/api/v1/collections`                                                                                              | GET         | session (owner list) / anon (public list)                                                                                                                                                   | list                                                                                                                                                   |
| `/api/v1/collections`                                                                                              | POST        | session                                                                                                                                                                                     | create; **cap check first**: `count < COLLECTION_LIMITS[tier]` else 409 `limit-reached` (beta: `free → 1`)                                             |
| `/api/v1/collections/{cid}`                                                                                        | GET         | owner, or visitor iff `isPublic`                                                                                                                                                            | one collection                                                                                                                                         |
| `/api/v1/collections/{cid}`                                                                                        | PATCH       | owner                                                                                                                                                                                       | update (name, description, isPublic, skin, skinOptions)                                                                                                |
| `/api/v1/collections/{cid}/artworks`                                                                               | GET         | owner / visitor-if-public                                                                                                                                                                   | the collection's live artworks (`deletedAt == null` always in the query)                                                                               |
| `/api/v1/collections/{cid}/artworks`                                                                               | POST        | owner                                                                                                                                                                                       | create (add form + CSV-confirm share this path); `photos: []` + staged-entry promotion in the same transaction (§6.3)                                  |
| `/api/v1/collections/{cid}/artworks/{aid}`                                                                         | GET         | owner, or visitor iff `isPublic` — **plus the check that `artwork.collectionId` is `{cid}`** (the rules admit a public artwork by id from _any_ collection; the client-side route must not) | one artwork                                                                                                                                            |
| `/api/v1/collections/{cid}/artworks/{aid}`                                                                         | PATCH       | owner                                                                                                                                                                                       | edit form; fields + optional staged photo/document entries in one transaction                                                                          |
| `/api/v1/collections/{cid}/artworks/bulk-delete`                                                                   | POST        | owner                                                                                                                                                                                       | `{ artworkIds: string[] }` → one transaction stamping `deletedAt`/`updatedAt` (the batch-of-400 `writeBatch` becomes one Postgres transaction)         |
| `/api/v1/collections/{cid}/artworks/{aid}/restore`                                                                 | POST        | owner                                                                                                                                                                                       | `deletedAt → NULL`. **Present but unused** — no trash/restore UI in beta                                                                               |
| `/api/v1/collections/{cid}/artworks/{aid}/photos/stage`                                                            | POST        | owner                                                                                                                                                                                       | multipart original → `{ entryId, width, height, size, contentType }` (validates type + size)                                                           |
| `/api/v1/collections/{cid}/artworks/{aid}/photos/process`                                                          | POST        | owner                                                                                                                                                                                       | `{ entryId }` → variant metadata (form previews render from it)                                                                                        |
| `/api/v1/collections/{cid}/artworks/{aid}/photos/{entryId}`                                                        | DELETE      | owner                                                                                                                                                                                       | discard a staged entry (user removed the tile)                                                                                                         |
| `/api/v1/collections/{cid}/artworks/{aid}/documents/*`                                                             | —           | owner                                                                                                                                                                                       | the same three, mirrored (`documents/process` generates `square_sm`/`large` for image docs)                                                            |
| `/api/v1/collections/{cid}/import/csv`                                                                             | POST        | owner                                                                                                                                                                                       | `{ rows: ArtworkPayload[] }` → validated against the shared schema, one transaction; response `{ inserted, rejected: [{ row, errors }] }`              |
| `/api/v1/media?key={objectKey}`                                                                                    | GET         | per §6 table                                                                                                                                                                                | streams the object                                                                                                                                     |
| `/api/v1/collections/{cid}/maintenance/sweep`                                                                      | POST        | owner                                                                                                                                                                                       | sweep abandoned staged objects (§6)                                                                                                                    |
| `/api/v1/collections/{cid}/maintenance/sweep-orphans`                                                              | POST        | owner                                                                                                                                                                                       | **optional, Phase 8** — final objects with no row                                                                                                      |

**Error model.** One envelope: `{ "error": { "code", "message" } }`. Codes
are a fixed, small set — `validation` (Zod issues, with the failed fields),
`unauthorized`, `forbidden`, `not-found`, `limit-reached`,
`field-not-writable`, `internal` — each mapped to its HTTP status
(400/401/403/404/409/409/500). Clients (web today, mobile tomorrow) switch
on `code`, never on `message`; `message` is prose for humans.

**The `/api/auth/*` carve-out.** The auth mount keeps Better Auth's native
response shape — `{ message, code }` on errors, and a 200 with a `null`
body when there is no session — because that is what the react client
consumes; re-wrapping it would break the client. The envelope above
applies to `/api/v1/*` only (decision, §15).

**What is deliberately not on the surface:** no hard-delete of collections
or artworks (soft delete is the model; the dead `deleteCollection` /
`deleteArtwork` are not revived), no email change (§5), no endpoints the
current client does not call. The surface is the current service layer,
translated — nothing invented (G2).

## 8. Web client migration

`src/` → `apps/web/src/` (git mv). Four buckets. The test doctrine in
`AGENTS.md` — altitude, mutation testing, "would this fail if Mantine
changed, or only if we changed?" — **carries over unchanged**; what changes
is which layer a test sits against (§11).

### Moved as-is (git mv; no code changes expected)

- `src/skins/**` — the contract, the registry, Basicx. Skins receive data
  through props and never touch a data layer; nothing in them knows the
  fetch comes from an API rather than Firestore.
- `src/components/collection/*` — `SkinHost`, `usePublicCollection` and its
  state union, the two route shells. They call the service layer; if the
  service layer keeps its signatures, they don't change.
- The manage-side chrome and doctrine: `ManageLayout`, `FormActionsBar`
  (the `BAR_HEIGHT` argument), `ArtworksTable` (sort/selection/pagination),
  the confirm-modal handling, the CSV in-browser parse/review.
- `src/utils/artworkPhotos.ts` → **`packages/shared`** (`sortPhotos`,
  `reindexPhotos` — client-contract order helpers).
- `src/utils/imageVariants.ts` → **`apps/api`** (`variantSize`, `coverCrop`,
  the geometry) — verbatim, `.rotate()` included (G4). Its consumer, the
  worker/encoding machinery, is deleted.
- `src/schemas/artwork.ts` is **split at the `deleteField` seam** in
  Phase 0: the pure core (validation, coercion, `ArtworkFormValues`,
  `toArtworkPayload`, `toNewArtwork`, `fromArtwork`) moves to
  **`packages/shared`**, and `src/schemas/artworkImport.ts` follows
  (it builds on `toNewArtwork`). Only `toArtworkUpdate` + `EDITABLE_FIELDS`
  stay in `apps/web/src/schemas/artwork.ts`: they call `deleteField()` from
  `firebase/firestore` at runtime — the `updateDoc` sentinel machinery is
  service-layer code that dies with the cutover, and the shared contract
  must not carry a runtime Firebase import.
- `src/types/index.ts` → **`packages/shared/src/types.ts`**, with two
  temporary carve-outs, both reversed in Phase 4 when the wire shape
  lands: `CollectionUpdate`/`ArtworkUpdate` (the `FieldValue`-sentinel
  mapped types) stay in `apps/web/src/types/updates.ts` next to the service
  layer that owns the Firestore merge semantics, and the `Timestamp`
  annotation keeps its type-only import of `firebase/firestore` — shared
  declares `firebase` as a devDependency (type-only usage, erased at build
  time, no runtime or server footprint). Until Phase 4 it is the only
  Firebase import outside `apps/web`, and it is one line to remove.
- The caps and accepted-type maps (`MAX_ARTWORK_PHOTOS`,
  `MAX_IMAGE_BYTES`, `ACCEPTED_IMAGE_TYPES`, `MAX_ARTWORK_DOCUMENTS`,
  `MAX_DOCUMENT_BYTES`, `ACCEPTED_DOCUMENT_TYPES`) →
  **`packages/shared`** `caps.ts`, carved out of `imageVariants.ts` /
  `artworkDocuments.ts` in Phase 0; the geometry table and the pure resize
  maths stay in web and move to `apps/api` verbatim in Phase 3.

### Moved to `packages/shared` (the client contract)

Types (`Collection`, `Artwork`, `ArtworkPhoto`, `ArtworkDocument`,
`ImageVariant`…); the Zod schemas; `slug`/`urlize`; the caps
(`MAX_ARTWORK_PHOTOS`, `MAX_ARTWORK_DOCUMENTS`); `photoUrl`/`photoSrcSet`
(unchanged — they read `url` off the entry, and the API fills `url` with a
proxy path); `COLLECTION_LIMITS` [v3 — `project-plan.md` §1]; the
photo-order helpers.

### Deleted (no tombstones)

- `src/services/firebase.ts` (and its importers), `authService.ts`,
  `collectionService.ts`, `artworkService.ts`, `imageService.ts` — replaced
  by the API client (§8 "rewritten").
- `src/context/AuthContext.tsx` — replaced by the Better Auth react client.
- `src/migrations/*`, `MigrationsPage.tsx`, `src/utils/maintenanceAccess.ts`
  — the migrations machinery is dead in a Postgres world (§1).
- `src/utils/imageProcessing.ts`, `imageWorker.ts`, `imageRender.ts` —
  generation is server-side; the probe and its whole silent-downgrade class
  of bug are gone.
- `src/utils/imageVariants.ts` — the variant table and its geometry moved
  to the API verbatim in Phase 3 S2 (`apps/api/src/media/variants.ts`,
  cross-checked by `tests/pipeline.test.ts`); the client copy is dead
  weight once nothing encodes in the browser.
- `functions/`, the rules files (`.rules`, `indexes.json`), `.firebaserc` —
  nothing left to deploy to Firebase from this repo.
- the `firebase` dependency (`firebaseui` was never one — checked) —
  deleted with the service layer in this phase; the dead
  `VITE_API_URL`/`VITE_USE_NEW_API` vars go in Phase 0 (§0.2 #3).

### Rewritten

- **Service layer → thin API client.** Same function names and signatures as
  today's service layer (`getCollectionArtworks`, `createArtwork`,
  `softDeleteArtworks`, …) — components keep calling the service layer, and
  the service layer becomes `fetch` + the shared Zod parse. That keeps the
  "follow the surrounding code" doctrine true on the cutover day.
- **`AuthContext` → the Better Auth react client.** `useAuth()` keeps its name and
  return shape; underneath it is the react client, session by cookie (web) /
  bearer (mobile).
- **`usePublicCollection`.** Same state union — `invalid | loading | error |
private | notFound | ready` — same pure decision functions, same doctrine
  ("`private` is not an error"). The fetch goes through the API client; a
  `permission-denied` Firestore error becomes an HTTP 403/404 and maps to
  the same states.
- **`useArtworkPhotos` / `useArtworkDocuments`.** The hook's state is now
  **staged entries** (`entryId` + server-returned variant metadata) rather
  than locally-processed blobs: the tile preview renders the staged original's
  proxy URL, reordering/keyboard/dnd is unchanged UI, and the
  object-URL-revocation lifecycle **disappears** (there is no local blob to
  pin).
- **Add/Edit artwork pages.** Save is one `POST`/`PATCH` carrying fields +
  staged entries (§6.3). The `?warn` doctrine — capture-once-on-mount,
  strip-on-mount-with-`replace`, table-lookup-not-`if` — **carries over
  verbatim**, and so does its mutation testing.
- **`ProfilePage`** [v3, Phase 5, `project-plan.md` §2]: first name, last
  name, change password. **Avatar (the `image` column) is deferred to
  Phase 8, optional** — it is a core column, so the deferral is a UI
  decision, not a schema one.
- **`ManagePage` / `NewCollectionPage` cap behaviour** [v3]: read
  `COLLECTION_LIMITS[me.tier]` (from `GET /me` + shared); show "1 of 1";
  disable the New Collection button at cap; a 409 `limit-reached` on the
  API is the enforcement, the UI just reflects it.
- **`/signup`** [v3, Phase 5]: the beta sign-up screen (`/login` gets a
  sign-up link; `SignupPage` calls `signUp`).
- **`vite.config.ts`:** gains `server.proxy['/api'] → VITE_API_TARGET`
  (default `http://localhost:8000`). The web client then calls **relative**
  `/api/…` paths — no env var in the built bundle, the same code that a
  same-origin deploy and a mobile client (absolute URL) will use.
- **`main.tsx`:** FirebaseUI and its imports come out; `MantineProvider`,
  `Notifications`, `Modals` stay.

## 9. Local development

`bun run dev` (root) runs **the whole stack**: the three compose services
come up (or are already up), then `bun run --parallel dev:api dev:web`.
One command, full product:

| Service               | Port(s)                     | Role                                                                    |
| --------------------- | --------------------------- | ----------------------------------------------------------------------- |
| Postgres 16 (compose) | 5432                        | `arcula` DB                                                             |
| SeaweedFS (native)    | 9000 S3 API / 9001 admin UI | the S3 stand-in; bucket `arcula`; lifecycle rules applied if configured |
| Mailpit (native)      | 1025 SMTP / 8025 UI         | the reset/verification mail sink — the inbox you actually read in dev   |
| API (Bun.serve)       | 8000                        | Hono app: `/api/auth/*`, `/api/v1/*`                                    |
| Web (Vite)            | 3000 (unchanged)            | the client; `/api` proxied to 8000                                      |

### Environment (`.env`, one file)

| Variable                                                        | Read by    | Local value                                                                                                      |
| --------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                  | api, seed  | `postgres://arcula:arcula@localhost:5432/arcula`                                                                 |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` | api        | SeaweedFS at 9000; bucket `arcula` (the §15 MinIO→SeaweedFS ruling)                                              |
| `AUTH_SECRET`                                                   | api        | random; committed in `.env` for dev only                                                                         |
| `EMAIL_PROVIDER` / `SMTP_HOST` / `SMTP_PORT`                    | api        | `mailpit` / `localhost` / `1025`                                                                                 |
| `CLIENT_ORIGIN`                                                 | api        | `http://localhost:3000` — the web origin the reset/verification mail links point at (§5; prod is the §10.3 host) |
| `SEED_EMAIL` / `SEED_PASSWORD` / `SEED_NAME`                    | seed       | the owner account                                                                                                |
| `ALLOW_DB_RESET`                                                | `db:reset` | defaults false; the script **refuses to run in prod** unless it is `true`                                        |

The dead `VITE_API_URL` / `VITE_USE_NEW_API` vars are **deleted**, not
defaulted (§0.2 #3).

### Scripts (root `package.json`)

- `dev` — `sh scripts/stack-up.sh` (start any service that is not already
  up), then parallel `dev:api` + `dev:web`. The mixed stack — postgres
  containerized, SeaweedFS/Mailpit native (§15) — is what the stack scripts cover.
- `db:migrate` / `db:reset` / `db:seed` / `db:studio` — in `apps/api`
  (§4); `db:reset` = wipe DB + both object prefixes + seed, one script;
  `db:studio` opens Drizzle Studio (the `drizzle-kit studio` subcommand —
  §15).
- `check` — tsc + eslint + prettier across workspaces.
- `test` — all suites, workspace-wide (§11).
- `deploy` — the gate suites, then `cdk deploy` (§10).

### API server shape

`Bun.serve({ port: 8000, fetch: app.fetch })` — Hono's `fetch` interface is
Bun's natively; `toWebHandler` exists for the non-Bun case and is not needed
locally. No framework ceremony.

## 10. AWS deployment (CDK)

### 10.1 The stack

One CDK app (`infra/cdk`, TypeScript); context vars `STACK_REGION`,
`DOMAIN`, `CERT_ARN`. Everything region-scoped lands in **`us-east-1`
(locked, v3)** — that is the one decision that is expensive to redo: RDS,
S3, the ACM cert, the ECR image, the ALB, and the VPC all live in the
region.

| Construct      | Choice                                                                               | Notes                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VPC            | two subnets (public + private), default config                                       | ALB in public, everything else in private                                                                                                                        |
| RDS            | Postgres 16, `db.t3.micro`, single-AZ in beta, gp3                                   | beta sizing; Multi-AZ and a bigger class are scale decisions, not beta ones. **No data migration** (§0.1) — the DB starts empty; `db:migrate` creates the schema |
| S3             | one bucket; `LifecycleRule` prefix `staging/`, expire 7 days; `BlockPublicAccess` on | the v3 key fix (§6) is what makes the prefix rule expressible                                                                                                    |
| SecretsManager | `DATABASE_URL`, `AUTH_SECRET`, `RESEND_API_KEY`                                      | looked up by name; the CDK app never contains values                                                                                                             |
| ECS            | Fargate, **single service** `api`                                                    | one task type runs the whole product: API + the built SPA (§10.2). Beta: fixed 2 tasks, no autoscaling — the cap implies a tiny fleet                            |
| ECR            | one repository                                                                       | image built locally, pushed (§10.4)                                                                                                                              |
| ALB            | L7, public subnet; 80 (redirect →443) + 443 (cert) → task:8000                       |                                                                                                                                                                  |
| CloudWatch     | default metrics; the api log stream (awslogs)                                        |                                                                                                                                                                  |

Migrations never run inside CDK: the stack creates an **empty** DB, and
migrations are **SQL files** (`packages/db` generates them; `db:migrate`
applies whatever `DATABASE_URL` it is pointed at). Prod = apply the same
SQL to the prod URL.

### 10.2 The container

Dockerfile (`infra/`): `FROM oven/bun` (debian — §0.2 #2: no official
`bun:alpine` exists, and Sharp's prebuilt NAPI binaries are most proven on
glibc) → copy the workspace manifests → `bun install` (production deps) →
copy the apps → `CMD ["bun", "run", "start"]`.

- `bun run start` in the container is the **same `main.ts`** as local
  (`Bun.serve`) — one code path, no container-specific variant.
- The same task serves **the built SPA**: Hono serves `apps/web/dist`
  statically at `/` — no second hosting stack in beta (CloudFront is the
  scale path, §14).
- Sharp: prebuilt on this base; the **WASM fallback** (`@img/sharp-wasm32`)
  is the documented escape hatch if a prebuilt ever fails in the container
  (§13.1).

### 10.3 DNS + TLS (Porkbun) [v3]

- **Region `us-east-1` (locked).** Sticky: a switch after the first deploy
  recreates RDS, S3, the ACM cert, the ECR image, and the ALB. The
  counter-argument (a mostly-European audience → `eu-west-1`) was on the
  table in review; the decision is made and recorded here so it is not
  relitigated.
- **Certificate — request it in ACM, don't import it.** `arcula.art` +
  `www.arcula.art` (alternate name) in the stack region; ACM returns DNS
  validation names → add them as records in Porkbun → validate. The cert
  then **auto-renews in ACM** — no 60-day re-import loop, which is what an
  imported Let's Encrypt cert would cost.
- **Porkbun records** (Porkbun's ALIAS record type _is_ CNAME-flattening,
  so the apex works):
  1. `arcula.art` (apex) → **ALIAS** → the ALB's DNS name (a `cdk deploy`
     output)
  2. `www.arcula.art` → **CNAME** → the same ALB DNS name
  3. (temporary) the ACM validation records, as ACM specifies
- **Then:** `cdk deploy -c DOMAIN=arcula.art -c CERT_ARN=… -c
STACK_REGION=us-east-1` → the 443 listener and 80→443 redirect come on;
  in the prod config the better-auth cookie flips to `secure: true`.
- **Fallback** if the apex ALIAS record is refused for any reason: the
  CloudFront distribution from §14 — its endpoint is CNAME-able at the apex.
  That is the scale path, not a defect.

### 10.4 Deploy flow

First deploy:

1. ACM: request the cert (`arcula.art` + `www` alternate name) → collect
   the validation records.
2. Porkbun: add the validation CNAMEs, plus the ALIAS/CNAME pair (step 3
   settles them).
3. Validate the cert. Build + push the image (`docker build` → ECR).
4. `cdk deploy -c DOMAIN=arcula.art -c CERT_ARN=… -c STACK_REGION=us-east-1`.
5. `db:migrate` against the prod `DATABASE_URL` (the schema SQL).
6. Seed the owner account (`db:seed` — the same script as local; prod is an
   empty DB, so seeding _is_ the bootstrap).
7. Verify end-to-end over HTTPS: sign up → sign in → create a collection
   (cap) → stage/process/save a photo → the public page.

Every later deploy: gate suites green → build + push → `cdk deploy`
(drift) → `db:migrate` if the schema changed → service image update.
**`db:reset` never runs in prod** (the `ALLOW_DB_RESET` guard, §9).

## 11. Testing

**The doctrine carries over verbatim** (AGENTS.md: altitude, mutation
testing, "would this fail if Mantine changed, or only if we changed?").
What changes is the _target_: the emulators disappear; **the local stack is
the test environment**.

### Porting map (current 313-test suite → new home)

| Current                                                                                                              | New home                                                                                                                                                          | Notes                                                                           |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Tier-1 pure logic (`artworkImport`, `parseAcquisitionDate`, `resolveSkinOptions`, `entryPrefix`, …)                  | same tests, moved next to the code: client-side logic → `apps/web/tests`; contract logic → `packages/shared/tests`                                                | unchanged; the altitude rule still applies                                      |
| `variantSize` / `coverCrop` / orientation                                                                            | `apps/api/tests`                                                                                                                                                  | pure functions; **the orientation assertions are the G4 guard**                 |
| `sortPhotos` / `reindexPhotos` / `photoUrl` / `photoSrcSet` / caps / `COLLECTION_LIMITS`                             | `packages/shared/tests`                                                                                                                                           |                                                                                 |
| the rules suites (88 tests, both)                                                                                    | **gone** — no rules left — but every case re-expressed as an **API integration test** against the local stack: same scenario, same assertion, HTTP instead of SDK | the owner/visitor authz cases, the storage name allowlist, the size/type limits |
| `skinHost` (the `cssVariablesSelector` assertion), `basicxSkin` (computed `pointer-events`), the `?warn`-param cases | carried over, unchanged                                                                                                                                           | tier-2 cases: the failure is invisible in a screenshot/review                   |
| component suites (forms, tables, the uploaders, the CSV review)                                                      | `apps/web/tests` — rendered against the **proxied local API**, not a mock                                                                                         | the service layer keeps its signatures (§8), so the component code barely moves |

### New cases (the v3 additions + the residuals)

- `PATCH /me` with `tier` (or any other non-writable field) →
  `field-not-writable`.
- A second collection create on a `free` account → 409 `limit-reached`
  (the cap, §1).
- **First upload of a fresh artwork is `order` 0** (G7); a duplicate
  `order` → the DB constraint fires, and the save fails loudly.
- `extensionFor` / `documentExtension`: **never `bin` for any name ×
  contentType** — the property, not the case; verified red by
  reintroducing the `extensionFor` call.
- Serializer: a saved artwork's GET response is **shape-identical** to the
  Firestore document (keys, nesting, `url` = proxy path, the
  `original`/`variants` split).
- Staging sweep: an abandoned staged entry is removed by
  `…/maintenance/sweep`; a final-prefix orphan (the residual, §6) is **not**
  touched by it — Phase 8's `sweep-orphans` handles that.

### Environment and mechanics

- Integration tests run against **the real local stack** (postgres in
  compose; SeaweedFS + Mailpit native; API at :8000) — real HTTP, real DB,
  real S3 semantics, real mail. **No MSW, no stubbed data layer** (G8); where a stub is
  unavoidable it stubs the **contract** (the shared Zod schemas), never an
  imagined API.
- Mailpit makes email assertions possible without any mocking: the reset
  flow is asserted by reading the captured message.
- `vitest` stays the runner; jsdom component tests keep the standing
  gotchas (explicit `afterEach(cleanup)`, the `matches: query === ""`
  matchMedia stub, `ModalsProvider`).
- **Mutation testing is the acceptance bar for anything new** — carried
  over verbatim.

## 12. Phases

Each phase ends with its exit criterion green **before** the next starts.
The sequence is ordered so that every later phase stands on verified ground,
and so that the Firebase→API cutover happens in one discrete step (G1).

### Phase 0 — Scaffold

Workspaces (`apps/*`, `packages/*`) in `package.json`; `git mv`
`src/`→`apps/web/src`, `tests/`→`apps/web/tests`; create `packages/db`,
`packages/shared`, `infra/cdk`; move the verbatim-eligible contract code
(types, the import schema, `slug`, the caps, the order helpers) into
`shared`; delete the dead `VITE_API_URL`/`VITE_USE_NEW_API` vars. The
`firebase` dependency is **not** deleted here: the web client still runs on
Firebase until the Phase 4 cutover, and this phase's exit criterion requires
that — the dep joins the §8 deletion bucket instead.
**Done when:** `bun run check` and `bun run build` are green across
workspaces, and `bun run dev` runs the web client (still on Firebase — the
api is an empty shell) as it does today.

### Phase 1 — Database

`packages/db`: the nine-table Drizzle schema (§4) + generated migrations;
`db:migrate`/`db:reset`/`db:seed`/`db:studio` scripts (wipe+seed, §4).
Better Auth drizzle adapter pointed at the schema, all four core tables

- the four custom columns declared in `additionalFields` **and asserted in
  a test** (the opaque-sign-up gotcha, §5).
  **Done when:** `db:reset` yields a working local DB with the owner account,
  and a sign-in through the adapter succeeds.

### Phase 2 — Auth

Better Auth `emailAndPassword` + `bearer`; session cookie config;
Mailpit/Resend provider interface; verification built-but-gated (§5);
`GET`/`PATCH /api/v1/me` with the writable set; `changePassword`.
Client: the Better Auth react client wired behind `useAuth()`.
**Done when:** the API test cases pass — sign up, sign in, sign out, reset
(verified by reading the Mailpit-captured mail), `PATCH /me` writable-set
rejections, bearer resolution.

### Phase 3 — Media pipeline

Sharp pipeline: stage / process / save / sweep (§6) with `.rotate()` (G4)
and the verbatim geometry; the `media` proxy with the §6 authz table;
the mixed local stack of §9 (postgres in compose, SeaweedFS + Mailpit
native — the §15 ruling that replaced the v3 "MinIO in docker-compose"
line).
**Done when:** the api test cases pass — variant geometry incl. orientation,
the `order 0` first-upload case (G7), sweep semantics, proxy authz
branches — **and the decision point is evaluated**: p95 per-photo ≤ ~3 s
and 10-photo save ≤ ~15 s on this machine. If either is exceeded, stop and
re-plan (queue + async) before Phase 4.

### Phase 4 — Web cutover

The service layer becomes the thin API client (§8); `useArtworkPhotos` /
`useArtworkDocuments` move to staged entries; Add/Edit save is the
one-transaction POST/PATCH; the Firebase service files, `AuthContext`, the
migrations machinery, and the client encoding machinery are **deleted**
(no tombstones); `vite.config.ts` gains the `/api` proxy; `main.tsx` drops
FirebaseUI.
**Done when:** the full product — sign in, manage collections/artworks,
photos, documents, CSV import, the public skin views — runs **end-to-end
locally on the new stack, with zero Firebase in the tree**, and the ported
test suite is green.

### Phase 5 — Beta scope [v3]

`/signup` screen (and the link off `/login`); the forgot-password path on
the same page plus the `/reset-password/[token]` form the live reset mail
points at; `ProfilePage` (first name, last name, change password — avatar
deferred to Phase 8); the one-collection cap: API enforcement
(409 `limit-reached`, §1) + UI reflection (`ManagePage` reads
`COLLECTION_LIMITS[me.tier]` via `collectionLimitForTier`; an at-cap direct
hit on `/manage/collection/new` is **deferred** — no redirect, the form's
existing 409 message is the answer; §15).
**Done when:** a fresh local account can sign up, set its profile, change
its password, is blocked at the cap with the right message, and the cap
cases in §11 pass.

### Phase 6 — Local polish + container + CDK stack

Compose file finalized; Dockerfile (`oven/bun`, §10.2) with the WASM
fallback verified or dismissed; `infra/cdk` (VPC/RDS/S3+LifecycleRule/
Secrets/ECR/ECS/ALB/CloudWatch, §10.1).
**Done when:** the container runs the full api; the CDK stack deploys
HTTP-only (no `DOMAIN`/`CERT_ARN` yet) and the app works against it.

### Phase 7 — Production cutover + docs

DNS/TLS exactly as §10.3 (ACM request → Porkbun records → validate →
`cdk deploy -c DOMAIN=arcula.art -c CERT_ARN=… -c STACK_REGION=us-east-1`);
cookie `secure: true` in the prod config; seed the prod owner account;
the end-to-end verification pass (§10.4 step 7). **`AGENTS.md` is
rewritten in this phase** — same doctrine (altitude, mutation testing),
new targets; and the internal identifiers move to the `arcula` naming
(`RENAME.md` — the Firebase project id `custodia-67307` stays where
legacy references need it).
**Done when:** `https://arcula.art` passes step 7, and `AGENTS.md`
describes the tree as it now is.

### Phase 8 — Optional (post-beta)

`sweep-orphans` (§6 residual); avatar upload (the core `image` column);
password-protected collections (the preserved `functions/` design note —
as a typed column + a check, not a Cloud Function, unless one becomes
necessary); the queue revisit if Phase 3's decision point ever trips.

## 13. Risks

| #   | Risk                                                                                                                                                                                                                        | Mitigation                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Sharp under Bun / in the container.** Prebuilt NAPI binaries are most proven on glibc — which is exactly why the container base is `oven/bun` (debian), not an alpine that does not exist (§0.2 #2).                      | The WASM fallback `@img/sharp-wasm32` is the documented escape hatch; verified in Phase 3 (native) and Phase 6 (container), not assumed                                                                                 |
| 2   | **The Better Auth drizzle adapter** is the least battle-tested joint in the stack; its generated pg schema and the `additionalFields` contract have real gotchas (undeclared columns → opaque sign-up failure; `text` ids). | Phase 1 asserts the contract **before** anything is built on it (sign-up through the adapter is the exit criterion); the custom field set is kept minimal — four columns, no more                                       |
| 3   | **SeaweedFS ≠ S3.** Lifecycle rules, `CopyObject` semantics, and auth can diverge between SeaweedFS and S3; a behavior that works in one can fail in the other.                                                             | Local self-heal deliberately does **not** depend on local lifecycle (`db:reset` clears prefixes, §6); Phase 4/6 verify the constructs that will ship in prod, and any divergence is a stop-and-replan, not a workaround |
| 4   | **The Phase 0 move.** Mechanical but large — a 313-test suite and a full `src/` relocated across workspaces; import paths, asset paths, and config are where subtle breaks live.                                            | `check` + `build` green required at each step, committed step by step (G1: never let two data layers coexist)                                                                                                           |
| 5   | **Apex ALIAS at Porkbun.** Verified supported (CNAME-flattening is a documented Porkbun record type); "verified" is not "will work in our exact console state".                                                             | The CloudFront fallback (§10.3) is one day of work, not a re-architecture — and it is the scale path anyway                                                                                                             |
| 6   | **Document drift.** The first attempt had plan documents and drifted from them anyway; an unrevised `AGENTS.md` describes a world that no longer exists.                                                                    | This document is a **living document**: update it the moment reality diverges (Phase 7 rewrites `AGENTS.md` on the cutover day)                                                                                         |

## 14. Rejected alternatives

| Alternative                                                          | Verdict                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pg-boss queue + separate worker + 202/polling for variant generation | **Rejected for v1; the decision point is kept live** (§6): sync stays while p95 per-photo ≤ ~3 s and 10-photo save ≤ ~15 s. The staging design means the switch would change the _transport_ only — no data-model or client-contract work                           |
| UUID primary keys                                                    | **Rejected.** `text`/nanoid matches the adapter's generated-schema convention and the codebase's existing convention (client-minted nanoid ids); nothing in this stack needs UUID semantics                                                                         |
| `status`/`error` columns on upload rows                              | **Rejected** with the staging redesign: rows are written only at save, and a failed save commits nothing, so there is no partial state for a status column to describe                                                                                              |
| Two-write save (v1: create, then update-with-photos)                 | **Superseded** by staging/promote — one transaction, §6.3                                                                                                                                                                                                           |
| OpenAPI spec generated in v1                                         | **Rejected until a second client exists.** The contract that needs pinning is the response **shape** (identical-to-Firestore JSON, §1), and that is pinned by the serializer tests; a spec document for a consumer that does not exist yet is documentation theatre |
| CloudFront + OAC / signed-URL media serving in v1                    | **Rejected for v1** (proxy serving is simpler, same-origin, and works for mobile); CloudFront returns as the scale path — and as the §10.3 DNS fallback                                                                                                             |
| Geometry (`variantSize`/`coverCrop`) in `packages/shared`            | **Rejected for v1; the move trigger is documented** (§2): it moves the day a second client generates variants client-side                                                                                                                                           |
| jsonb canonical user store [v3]                                      | **Rejected** (G9): with Drizzle + generated migrations, a typed column is a one-line edit; the bag form gives up type safety, constraints, and queryability — exactly what choosing Postgres/Drizzle buys. Logged so it is not re-proposed                          |
| Dual-backend toggle (`VITE_USE_NEW_API`) [v3]                        | **Rejected** (G1): the cutover is one step; two data layers in one tree is exactly the failure that killed the first attempt                                                                                                                                        |
| MSW-mocked data layer in tests [v3]                                  | **Rejected** (G8): mocks that the real API would fail are how a broken app ships green. Tests target the local stack; stubs, where unavoidable, mock the contract                                                                                                   |
| `requireEmailVerification: true` from day one                        | **Rejected for beta** — it would block the owner's own onboarding (no verified email exists yet). Built-but-gated (§5) keeps the beta usable and the later enablement a config flip                                                                                 |
| Email change in scope                                                | **Out of scope** (§5): needs verify-before-update + confirmation email — a different decision, a different phase                                                                                                                                                    |
| Data migration / Firebase-UID mapping                                | **Not a requirement** (§0.1): the current project is test data; an empty DB is the assumption the whole design is tuned to                                                                                                                                          |

---

## 15. Amendments (post-Phase 0)

The living-document rule (§13 risk 6) applies to amendments as it does to
anything else: when reality diverges from an earlier section, patch that
section in place **and** record the divergence here, dated. This is the
ledger.

- **2026-10-03 — `db:studio`: dropped, then restored (owner's ruling,
  corrected finding).** First dropped on the finding that no Drizzle-Studio
  npm package exists in this registry (`@drizzle.studio`,
  `@drizzle/studio`, `drizzle-steam` probed, absent). That finding was
  incomplete: `drizzle-kit@0.31.11` ships the Studio as a `studio`
  subcommand (beta), and it works here — it loads `drizzle.config.ts`,
  connects through the pg driver, and serves the UI at
  local.drizzle.studio. `db:studio` is wired to it; the §9/§12 lines are
  restored. Ad-hoc inspection remains `docker-compose exec postgres psql`.

- **2026-10-03 — Mixed local stack: Postgres containerized; S3 stand-in and
  Mailpit native.** The docker registry reachable from this machine (colima)
  hosts neither `minio/minio` (pull denied / not found) nor the Mailpit
  image, `dl.min.io` is 410 Gone, and MinIO no longer ships darwin builds
  (three releases checked: none) — so §9's "three compose services" cannot
  stand as written. Postgres keeps its container (`postgres:16` is local).
  The MinIO slot goes to **SeaweedFS**: `minio` is a dead end here — the
  Homebrew bottle segfaults on this machine (go-m1cpu cgo SIGSEGV, even on
  `--version`), and its upstream is archived (formula deprecated, disabled
  2027-02-17). SeaweedFS keeps the shape the plan needs: one pure-Go
  process that implements the S3 API and stores objects locally
  (`weed server -dir=… -s3`), from a maintained upstream (Apache-2.0,
  current bottles), serving 9000 for S3. Its volume server's default HTTP
  port is 8080 — the Firestore emulator's default (`test:rules`), so
  `stack-up.sh` passes `-volume.port 8090`; the S3 API on 9000 is the only
  surface the app uses. `mailpit` (Homebrew, MIT,
  current) fills its slot at 8025/1025. `scripts/stack-up.sh` /
  `stack-down.sh` cover the mixed start/stop, and `dev` calls stack-up
  first. `S3_FORCE_PATH_STYLE=true` is load-bearing for it: the S3
  endpoint is the service root, not a resolvable host.

- **2026-10-03 — Two `.env` rulings recorded.** `AUTH_BASE_URL`
  (`http://localhost:8000/api/auth` locally; the prod value is
  `https://api.arcula.art/api/auth`, §10.3) is a Phase 1 addition, not a
  §9 line. And the first-attempt `RESEND_API_KEY` / `EMAIL_FROM` values
  stay in `.env` as prod inputs (owner's ruling, Phase 0) — named for
  §10's prod config, not §9's local table; `.env` is gitignored, so no
  value in it is a committed artifact.

- **2026-10-03 — better-auth 1.7.7 API vs the §4/§5 wording (verified
  against the installed package, all four).** (a) `user.additionalFields`
  takes **type-discriminator attributes** (`{ type: "string", required,
defaultValue }`), not Zod schemas — §5's "Zod-typed" wording did not hold.
  (b) The `includeFields` option no longer exists; `returned` (default
  `true`) already puts all four custom fields in session responses, so the
  §5 goal is met by default. (c) Email+password is a **core feature**
  configured through the `emailAndPassword` section (`enabled: true`,
  `requireEmailVerification: false` — G6's explicit flip), not a plugin.
  (d) The `account` core model is `providerId`/`accountId` with no
  `method`/`type`/`clientId`/`salt` — §4's line is amended in place. Also
  recorded from the same verification: a failed `.api` call **throws** an
  `APIError` (`{ status, body: { message, code } }`) and a success resolves
  the endpoint body; sign-up requires `name` in the body; duplicate email
  is `USER_ALREADY_EXISTS*`. (e) The Drizzle adapter is a **direct
  dependency** of `apps/api` — `@better-auth/drizzle-adapter` pinned to the
  matching `1.7.7`, per the official docs — not an import of better-auth's
  `./adapters/drizzle` re-export of it (same code either way).

- **2026-10-03 — Phase 2 (auth) executed; §5/§7 wording vs 1.7.7 and the
  live-stack findings.** (a) **Auth errors stay native (§7 amended).**
  Ruling: the §7 envelope applies to `/api/v1/*` only; `/api/auth/*` keeps
  Better Auth's shape (`{ message, code }`; a 200 with a `null` body when
  no session — status alone is not the signal) because that is what the
  react client consumes. (b) **Mount surface:** `auth.handler` (a fetch
  handler) is the 1.7.7 framework-agnostic surface; `toWebHandler` does
  not exist in its exports — §5 patched. (c) **Cookie Secure switch:**
  `advanced.useSecureCookies` (httpOnly + SameSite=Lax are the library
  defaults, asserted in the S2 cookie-flags test). (d) **API-test
  transport (§11):** "real HTTP" is read as in-process `app.request()`
  against the real stack — real routes, real DB, real SMTP; the elided hop
  is the outermost TCP one, and no second server process is spawned.
  (e) **Origin/CSRF (verified live):** a state-changing request carrying
  the session cookie validates Origin — untrusted → 403
  `INVALID_ORIGIN`, missing → 403 `MISSING_OR_NULL_ORIGIN`; the session
  survives the refusal. Under `NODE_ENV=test` the library skips origin
  checks entirely (`isTest()`), so the suite asserts the config does not
  opt out of them instead of re-testing the library. (f) **Reset/verify
  URLs:** the reset token rides the path (`/reset-password/<token>`), not
  a query param; `send-verification-email` wants `{ email }` in the body.
  Both hook URLs arrive on the API origin and are rewritten to
  `CLIENT_ORIGIN` (new §9 line — the web app renders those routes in
  Phase 4). The sign-up auto-send of the verification mail is gated on
  `sendOnSignUp ?? requireEmailVerification` — both off here is G6, and
  the test asserts the gate (no mail at sign-up; the on-demand endpoint
  works and flips `emailVerified`). (g) **The react client is not
  `@better-auth/react`:** in 1.7.7 it is the `better-auth/react` subpath
  of the main package (nanostores-based: `createAuthClient`,
  `client.useSession()` as a client method, no provider component), so
  `apps/web` pins `better-auth@1.7.7` alongside `apps/api`. The previously
  accepted `@tanstack/react-query` dependency (ruling #5) is unnecessary
  for this client and was not added. (h) **Mailpit's REST is
  PascalCase** (`ID`, `To`, `Subject`, `Snippet`; the full `Text` only on
  the single-message endpoint) — the test helpers are written to it.
  (i) The `.env` value `EMAIL_PROVIDER=smtp` was normalized to `mailpit`,
  the §9 table's value (nodemailer over Mailpit's SMTP, per the ruling).

- **2026-10-03 — Phase 3 S3: stage transport is a multipart POST, not a
  presigned PUT (§6 step 1 amended in place).** A presign would have added
  a second endpoint and a temporary-credential surface for an upload that
  is already authenticated by the session. The stage route takes
  `{ entryId, file }` as multipart on the session cookie or Bearer, and
  validates type (shared allowlists) and size (shared caps) **as the body
  arrives**: `bodyLimit` is the coarse guard, the exact check is on the
  parsed `file.size`. The check order is allowlist → size → decode, so the
  cheapest failure comes first. The stage/process responses are supersets
  of §7's minimal shapes (stage reports the original's
  `width`/`height`/`size`/`contentType`; process reports a `url` per
  variant): §7's minimal shape is a floor, not the contract. A PDF
  document's process is a no-op (`variants: []`).

- **2026-10-03 — Phase 3 S4: `order` is array position; the §7 save row
  read as create-then-PATCH.** The §7 "save" line (POST creates with
  `photos`/`documents`; PATCH replaces the sequence) is read as the media
  routes requiring **collection ownership only, not an existing artwork
  row**: the Add flow mints `artworkId` client-side, and the save creates
  the row and promotes the staged entries in one transaction. Each
  payload entry's `order` is its array position (the reindex), and the
  write runs four passes under `UNIQUE (artworkId, order)`: delete the
  removed rows (they vacate slots), park the kept rows that must move at a
  sentinel order (walking **current** order, not payload order, so two
  concurrent saves take row locks in the same order and cannot deadlock),
  insert the new entries, then bring the parked rows home. Two saves that
  race for the SAME slot collide on the constraint → `23505` → a
  retryable `internal`. Entry ids are table-wide PKs and a silent stale
  upsert was a real trap, so the saves also run `assertEntriesFree`: POST
  rejects any entry id already in the table; PATCH rejects promoted ids
  not stored for this artwork — both 400 `validation`.

- **2026-10-03 — Phase 3 S4: Hono sub-app `use("*")` leak (per-route
  middleware).** `Hono.route()` re-registers every sub-app route
  _including `use` routes_ with the base path (verified in
  `hono-base.js`), so a sub-app `use("*", requireSession)` mounted at
  `/api/v1` becomes `/api/v1/*` and 401'd every anonymous public read.
  Auth is attached per route inside mounted sub-apps; the routes carry a
  comment recording why there is no wildcard middleware.

- **2026-10-03 — Phase 3 S5: the collection surface, as built.**
  (a) `POST /collections` runs the cap check **first** (§7): the
  owner's count against the shared `COLLECTION_LIMITS[tier]`, 409
  `limit-reached` when reached; validation runs before the cap, so a
  malformed body at the cap is a 400, not a 409. (b) The CSV import
  validates each row **individually** against the shared `artworkSchema`:
  a failing row lands in the 200 response's `rejected` (index + failed
  fields) and the accepted rows are written in one transaction with
  server-minted ids — the envelope is deliberately loose because a
  batch-wide 400 would have discarded the healthy rows. (c) Bulk delete
  is one transaction that stamps `deletedAt`/`updatedAt` on **live**
  works only (`isNull` guard) and counts only what it moved; foreign or
  already-deleted ids do not count. (d) Restore is `deletedAt → NULL`,
  idempotent, `{ restored: true }`. (e) The collection PATCH is JSON
  null-semantics — present sets (or, as `null`, clears), absent leaves —
  which is what the settings form's write-only-what-changed payloads need.

- **2026-10-03 — Phase 3 S6: the media proxy's 404/403/401 split and
  caching (§6 authz table).** A visitor gets a 404 on a private or
  deleted work's photos (uniform — the same disclosure call as the
  single-artwork read); documents 403 for everyone else **including
  anonymous callers** (the "renders a 403 rather than a leak" call, which
  §6 makes explicit); staged objects are 401 with no session and 403 for
  a non-owning session. Headers come from the stored row for final
  objects (the document original from the base row, everything else from
  the variant row) and from the object's own recorded metadata for staged
  objects. Final responses carry `Cache-Control: public, max-age=3600`
  (an object at a final key only changes if the owner re-saves the same
  entry, which the client does not do); staged responses carry
  `no-store`. The sweep deletes the collection's staged objects whose
  entryId has no row; an entry that HAS a row keeps its staged objects
  even under a soft-deleted work — the row is what a restore would point
  at, and the staged object may be the entry's newest version.

- **2026-10-03 — End of Phase 3: `test:rules` was red in two ways since the
  Phase 0 restructure, and both are now fixed.** No gate had run it since
  the move, so the breakage only surfaced at the phase's final gate.
  (a) **Three suites died at import** (`auth/invalid-api-key`): the web
  project moved to `apps/web`, but its `vitest.config.ts` never mirrored
  `vite.config.ts`'s `envDir: <repo root>`, so the `VITE_FIREBASE_*` vars
  that `src/services/firebase.ts` initializes from were invisible to the
  tests — and the Phase 0/2 rewrite of the gitignored root `.env` had
  dropped them from there anyway. Fix: `envDir` mirrored in
  `vitest.config.ts`, plus a committed root `.env.test` with the
  **emulator** values (project `demo-custodia`, placeholder key — no real
  project is ever contacted, the emulators are the target under
  `emulators:exec`). `.env.test` is test-mode-only and overrides `.env`,
  so restoring real values to `.env` for dev cannot leak into the suites.
  (b) **Eleven component suites lost their jest-dom matchers**
  (`Invalid Chai property: toBeInTheDocument`): jest-dom v7's `/vitest`
  entry calls `expect.extend()` from inside `node_modules`, and
  externalized modules import the package-level `vitest`, not the
  runner's worker `expect` — so the matchers registered nowhere. Fix:
  `server.deps.inline: ["@testing-library/jest-dom"]` in
  `vitest.config.ts`; one line, zero test-file changes. Result:
  `test:rules` is 403/403 (353 web + 50 shared). Standing state: plain
  `test:web` is green except the two rules files, which need the
  emulators (the pre-restructure behaviour — they were always
  `test:rules`-only). **Open, owner-side:** the real `VITE_FIREBASE_*`
  values are lost with the `.env` rewrite, so the legacy web app cannot
  boot in dev (Firebase init throws on page load) until either the
  values are restored to `.env` or Phase 4 deletes the Firebase imports
  (which it does).

- **2026-10-03 — Phase 3 S7: the decision point measured; plan amended in
  place.** Measured on this machine against the real stack at ~12MP
  sources: p95 per-photo process **0.16 s** (limit ~3 s) and the
  10-photo save **0.19 s** (limit ~15 s). No queue; Phase 4 proceeds.
  Amended in place: §6 step 1 (presigned PUT → multipart POST), §12's
  "MinIO in `docker-compose.yml`" line (§9's mixed stack), §8's deletion
  list (`src/utils/imageVariants.ts` — the table moved to
  `apps/api/src/media/variants.ts` verbatim in S2, cross-checked by
  `tests/pipeline.test.ts`), and §13 risk 3 (MinIO → SeaweedFS wording).

- **2026-10-04 — Phase 4 S1: the auth cutover, the same-origin base, and the
  test transport.** (a) **The client has no baseURL (form verified).**
  Omitting `baseURL` makes `getBaseURL` (better-auth `dist/utils/url.mjs`,
  1.7.7) fall back to `window.location.origin` + `basePath` in the browser:
  the dev page (Vite :3000) fetches `http://localhost:3000/api/auth/…` and
  Vite's new `server.proxy["/api"]` (`VITE_API_TARGET ??
http://localhost:8000`, `changeOrigin`) forwards it; prod is same-origin
  per §10.2, so no env var is baked into the bundle. `VITE_API_BASE_URL`
  (the Phase 2 absolute base) is retired from `vite-env.d.ts`;
  `VITE_API_TARGET` is declared there but read by the test transport only —
  no app code reads an env var. Caveat: without a `window` (node test
  environment) the base resolves to the relative `"/api/auth"`, which
  better-fetch rejects (it requires an absolute URL) — so any test that
  touches the react client runs jsdom, whose default page URL
  `http://localhost:3000` is exactly the dev origin the transport emulates.
  (b) **The react client does not reject on auth failure (corrects the
  Phase 2 AuthProvider assumption).** better-fetch rejects only with
  `throw: true`, which the client never sets: a failed sign-in RESOLVES to
  `{ data: null, error }` where `error` is the response body spread with
  status — a flat `{ message, code, status, statusText }`. This is not the
  `BetterFetchError` class shape (`{ status, error: { message, code } }`,
  `.message` = the status text) that the Phase 2 entry (d) recorded for the
  server-side `.api` client; the two are different and only the flat one
  reaches the browser. `AuthProvider.login` now rethrows it (lifted onto a
  real `Error` carrying `status`/`code`, per lint's `only-throw-error`), and
  `LoginPage` maps the flat shape: 401 `INVALID_EMAIL_OR_PASSWORD` and 400
  `INVALID_EMAIL` (both verified on the wire). The cutover itself:
  `App.tsx` → `./auth/AuthProvider`, `hooks/useAuth.ts` re-exports
  `auth/useAuth`, `context/AuthContext.tsx` deleted, `NewCollectionPage`
  signs out through the provider.
  (c) **Test transport = Vite proxy emulation (G8 mechanism).**
  `tests/helpers/stackFetch.ts` wraps the global fetch: relative URLs
  resolve against the app origin, app-origin requests are re-hosted onto
  the API target, a single cookie jar is carried (cookie deletion via
  `Max-Age=0`/expired/empty included — how sign-out clears the session),
  and state-changing requests carry `Origin: http://localhost:3000`. The
  jar, the installed-flag and the underlying native fetch live on
  `globalThis` under `Symbol.for` keys, because a vitest worker is reused
  across test files, each with a fresh module registry — module-scope state
  would orphan the installed wrapper's jar. `tests/setup.ts` installs it
  (setupFiles run before the module graph, which matters: the react client
  captures the global fetch at module load) and clears the session in
  afterAll, so every file starts anonymous. `tests/sessionTransport.test.ts`
  pins the seam: sign-up → sign-in → get-session round-trip →
  `/api/v1/me` on the same cookie → sign-out (cookie deletion honoured) →
  anonymous 401 → the failed sign-in's 401 + code.
  (d) **The origin check is Sec-Fetch-driven, not cookie-driven (measured;
  refines the Phase 2 (e) wording).** Two middlewares:
  `originCheckMiddleware` validates Origin only on state-changing requests
  that carry a `cookie` header (GETs skipped); `formCsrfMiddleware` is
  mounted on sign-in/sign-up only and FORCES origin validation when ANY
  `Sec-Fetch-*` header is present — cookie or not. Node's undici always
  sends `sec-fetch-mode: cors`, so a cookie-less sign-up from Node 403s
  `MISSING_OR_NULL_ORIGIN` without an Origin header, while curl (no
  Sec-Fetch headers) passes the identical request. Consequences: the
  transport's blanket Origin on every state-changing request is mandatory
  rather than defensive, and real browsers are unaffected (same-origin
  requests carry `sec-fetch-site: same-origin` plus a trusted `Origin`).
  (e) **The `test:web` gate.** Root `test:web` now runs `stack-up.sh` and
  the new `ensure-api.sh` first (nohups `bun src/main.ts` when
  `:8000/api/health` is down and polls it; the API's env is the repo-root
  `.env` sourced explicitly — bun does not walk up parent directories for
  `.env`, so `dev:api` only works inside the root `dev` chain).
  `stack-down.sh` accepts `api` as an opt-in service, never in the default
  set: a dev API started by `bun run dev` must survive a plain
  `stack-down`.

- **2026-10-04 — Phase 4 S2–S5: the client cutover, landed as one commit.**
  (a) **The commit boundary.** One commit per step does not hold for S2–S5:
  the service signatures, the staged hooks and the two save flows are one
  interlocking unit — `createArtwork`'s payload is what `commit()` answers,
  and the hooks' entry shape is what the pages render — so no intermediate
  commit compiles. The four steps landed together, with this entry standing
  in for the per-step records.
  (b) **The `Timestamp` pull-forward.** Shared's last Firebase reference was
  type-only: `import type { Timestamp } from "firebase/firestore"`. It is now
  a local `interface Timestamp { seconds, nanoseconds }` — the wire shape
  the API serializer already emits, character-for-character Firestore's — so
  `@arcula/shared` carries no Firebase import at all, and S6 can delete the
  `firebase` dependency everywhere without a shared-package exception.
  (c) **`?warn` is killed entirely (owner's ruling), not re-expressed.** The
  Add page is one write: the only outcome where nothing was written stays on
  the form with an alert (the 409 `limit-reached` envelope message verbatim,
  a generic one otherwise), and every success redirects to the created work.
  There is no partial-upload state left for a `?warn` link to point at, so
  the param, its capture-once and its strip-once effect are deleted, with
  their suite (`tests/artworkWarnParam.test.tsx`).
  (d) **Upload failures surface as the uploader's rejected list, not as a
  page param.** The hook's per-file refusals (cap, type, the stage route's
  own answer) and the Dropzone's validator refusals fold into one per-file
  list rendered above the grid. Testing found a clobber in that wiring:
  `handleDrop` replaced the list when the staging settled, erasing the half
  the synchronous `onReject` had just written — the "one-frame flicker"
  AGENTS.md describes. Both uploaders now append-or-skip, and the mixed-drop
  tests pin it. (Test mechanics worth knowing: `userEvent.upload` honours
  the input's `accept` hint and silently drops non-matching files, so the
  mixed-drop tests deliver both files on a manually dispatched `change`
  event — jsdom has no `DataTransfer`.)
  (e) **The storage-rules suite died with its subject, pulled forward from
  S6.** `tests/storage.rules.test.ts`, `tests/artworkFiles.test.ts` and
  `tests/helpers/rulesSource.ts` tested the client's Firebase Storage upload
  path, which no longer exists: objects go through the API's stage route, and
  this app consults no `storage.rules` any more. §11's "the 88 rules tests
  are gone" already settled the count; this records which half died in which
  commit. `firestore.rules.test.ts` stays until S6, with the rest of the
  Firebase tree.
  (f) **Ids are minted hyphen-free — the API's UUIDs were a latent break of
  the route convention (amends G3's "nanoid" assumption toward the code).**
  G3 says ids are `text`/nanoid everywhere; the built API minted
  `crypto.randomUUID()` — hyphenated. That is fatal for the
  `{urlizedName}-{id}` segment: `parseId` (the one place that knows the
  convention) cuts at the LAST hyphen, so a hyphenated id's cut lands inside
  the id and recovers its last segment instead of the id. Nothing is
  deployed, so the fix is at the mint: the API's two mint sites and the
  client's Add-page mint now produce `uuid().replace(/-/g, "")` (32 hex),
  and `parseId` and the slug helpers are unchanged. Staged-entry ids stay
  full UUIDs: they never enter a URL.
  (g) **The PATCH's `currentDocs` read now carries `ORDER BY id`** (the
  photos read already did). Defensive: when the payload omits `documents`,
  the handler re-derives the sequence from the stored rows, and Postgres
  gives no order without an explicit one. `apps/api/tests/save.api.test.ts`
  pins the answer — two PDFs seeded and created in descending id order,
  PATCH without `documents`, the response ascending — and says in the test
  that the serializer's own sort would keep it green today.
  (h) **The cap UI stays Phase 5 (owner's ruling).** Phase 4 renders the 409
  `limit-reached` envelope message on collection create and nothing more of
  the cap mechanics.

- **2026-10-04 — Phase 4 S6: Firebase is out of the tree.** The last
  Firebase import was a module-scope `getAuth()` in
  `src/services/firebase.ts`, pulled into every page load by the statically
  imported `MigrationsPage` route (the Firestore-era maintenance tool); with
  the `VITE_FIREBASE_*` vars already gone from `.env`, that initialisation
  threw `auth/invalid-api-key` at boot. Removed in one pass: the
  `firebase`/`@firebase/rules-unit-testing` dependencies,
  `services/firebase.ts` and `services/authService` (zero remaining
  consumers), the migrations mechanism (`src/migrations/`,
  `MigrationsPage`, `utils/maintenanceAccess` + its test, the Settings-page
  card, the `/manage/migrations` route), `firestore.rules.test.ts`, the
  `firestore.rules`/`firestore.indexes.json`/`storage.rules` files,
  `firebase.json`, `.firebaserc` and `.env.test` (emulator test env), and the
  `test:rules`/`emulators`/`deploy:rules`/`deploy:hosting`/`deploy` scripts
  with the `firebase-tools` dependency. AGENTS.md carries the 4-line
  historical banner (owner's ruling) and now reads as the record of the
  system the codebase used to be. Note the deploy story: the firebase
  hosting/rules deploys are gone with the tooling, and the new stack has no
  deploy path yet — deliberately out of Phase 4's scope, which stops at the
  local stack.

- **2026-10-04 — `dev:api` sources the root `.env` explicitly; the S1 "works
  inside the root dev chain" claim is withdrawn.** A fresh `bun run dev`
  crashed `dev:api` at module load with `EMAIL_FROM is required to send
mail`: `bun` run from `apps/api/` loads no `.env` (there is none there, and
  it does not walk up parent directories), and the nested `bun run` chain did
  not carry the root `.env` down either. It had never actually been
  verified — every API instance that had worked so far came up through
  `ensure-api.sh`, which sources `.env` explicitly. The fix is the pattern
  every other `apps/api` script already uses (`db:*`, `test`): `dev` now
  runs `set -a && . ../../.env && set +a && bun --watch src/main.ts`. Vite
  was never affected — `vite.config.ts` loads the root `envDir` itself.

- **2026-10-05 — Phase 5: beta scope landed (S1–S3).** The sign-up screen,
  the password-reset path, the profile page, and the cap UI:
  (a) **Sign-up collects email + password + first/last name** (owner's
  ruling). Better Auth's sign-up body requires the core `name`, so the
  payload derives `name` from the trimmed first + last, and the custom
  fields ride the same body as additional fields (the handler forwards
  every key it does not own to the user row); `me.api.test.ts` pins the
  seam end to end (sign up with fields → `GET /me` serves them back plus
  the `tier` default). The error codes are Better Auth's native ones
  (422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, 400 `INVALID_EMAIL` /
  `PASSWORD_TOO_SHORT`), not the Firebase codes `project-plan.md` §3
  listed — that section predates the cutover.
  (b) **Forgot-password is in Phase 5** (owner's ruling; `project-plan.md`:
  reset "belongs on the same page" as sign-up): a request mode on
  `/signup` plus the `/reset-password/[token]` form. The API side was live
  since Phase 2 (routes + mail hook, pinned by `email.api.test.ts`) — what
  was missing was the page the mail's token link lands on; the catch-all
  route used to send the token back to `/`.
  (c) **The `/me` foundation.** `sessionUserSchema` + `mePatchSchema` in
  `packages/shared` (the wire contract; `me.ts` now validates against the
  shared patch schema instead of a local copy), `meService` parses both
  directions through them, and `AuthProvider` fetches `/me` once the
  session is known and exposes `me` on the context — a failed read degrades
  to `null`, and tier UI falls back to the free limit, the same fallback
  the API makes. `toAuthError` (auth/errors.ts) centralises better-fetch's
  non-rejecting failure shape (`{ data: null, error }` → a real `Error`
  carrying `status`/`code`).
  (d) **The profile page** (`/manage/profile`): name through
  `PATCH /api/v1/me`, password through Better Auth's native
  `change-password` — the old `reauthenticateWithCredential` dance the
  project plan described is the endpoint's own `currentPassword` check on
  this stack. The name save sends only the changed, non-blank keys (a blank
  is not a value: absent keys are "leave alone" on the PATCH, and the
  shared `mePatchSchema` rejects `""` on the wire), and a no-change submit
  is no write at all. The user menu replaces the empty avatar with an
  initials avatar plus a label on the fallback chain the data actually
  has: first + last (the profile) → the session's core `name` (the seeded
  account has one but no first/last yet) → the email.
  (e) **The cap UI.** `ManagePage` gains the New-collection button (which
  the S2–S5 rewrite had lost — it existed in the Firebase-era page) and an
  "N of 1" counter; the limit reads through `collectionLimitForTier`
  (unknown/absent tier → free), which the API's create check now uses too —
  one function on both sides, pinned by
  `packages/shared/tests/limits.test.ts`. The at-cap control is a real
  disabled `<button>`, not a disabled `component={Link}`: a disabled anchor
  is not a thing, and the failure the test exists for is a control that
  looks capped but still navigates to a form the server refuses.
  (f) **The at-cap direct hit on `/manage/collection/new` is deferred**
  (owner's ruling): no redirect, no cap state on the page — the form
  renders and submitting shows the existing 409 `limit-reached` envelope
  message. `project-plan.md`'s "redirects to the collection the account
  already has" stands as the recorded spec for a future pass.
  Mantine 9.6.3 gotcha, recorded for the next person: in uncontrolled
  `useForm`, `form.values` is a snapshot of the last render — typing
  re-renders nothing on purpose — so a live read outside the submit path is
  `form.getValues()` (the internal ref the submit path validates).

---

## Closing
