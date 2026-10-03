I've finished mapping both the current app and the prior `hono-api` attempt, and I've reviewed the alternative plan (`API-MIGRATION-QWEN.md`) against mine. This is the **merged plan**, updated to match the review decisions of 2 Oct 2026. It supersedes both source documents.

---

# Plan: Firebase → Hono + Drizzle + Postgres + S3 + Better Auth (Arcula `hono-api-ii`)

> Status: **proposed, not yet implemented.**
>
> Provenance: this merges `API-MIGRATION-DEEPSEEK.md` (server architecture) with
> `API-MIGRATION-QWEN.md` (migration strategy). §13 records what was taken from
> QWEN, what was rejected and why, and the final decisions.

## 0. What I found (context for the rewrite)

**Current model (Firestore, camelCase)** — the plan must match this exactly, not the invented shape the prior attempt used:

- `Artwork` fields: `title`, `artistName` (**required**), `serie`, `dateOfCreation`, `media`, `dimensions`, `editions`, `acquisitionDate` (strict `YYYY-MM-DD`), `acquisitionPrice` (**string**), `placeOfOrigin`, `provenance`, `condition`, `currentValue` (**string**), `notes`, `photos[]`, `documents[]`, `isPublic` (default true), `deletedAt`.
- `Collection`: `name`, `description`, `isPublic`, `skin`, `skinOptions`, plus unused `passwordHash`/`artworks[]`.
- Photos/documents embed full Firebase download URLs + a `variants[]` array.

**The prior `hono-api` branch is incomplete and drifted:**

- It added a parallel `apps/web` but **left the root `src/`, `tests/`, `firebase.json`, rules, and emulator scripts in place** — two half-apps.
- Its Drizzle schema **invented fields** (`medium`, `year`, `price`, `status`, `location`, `tags`, `description`) and made `artistName` nullable, contradicting the real form model.
- It stored `urlizedName` and full URLs alongside keys (stale on rename/CDN change).
- Server image code **re-implemented** the variant geometry instead of sharing it, and never called `.rotate()` (EXIF orientation — phone photos would ship sideways).
- It pinned Zod 3 in the API while web used Zod 4; it left `requireEmailVerification: false` with Resend effectively unused; no queue.
- A confirmed off-by-one: new photos got `orderIndex = max + 1` (so the first photo is 1, not 0).

We start fresh, using that branch only as reference for CDK/packages layout.

**Guiding principle (adopted from QWEN).** Keep the **wire contract stable** and move the **work server-side**. The API returns the _same JSON shapes_ the client already consumes (`Artwork`, `ArtworkPhoto.variants[]`, `ArtworkDocument`), with `url` values becoming durable same-origin paths instead of Storage URLs. That keeps `photoUrl`/`photoSrcSet`/`sortPhotos`, the skins, and most component tests working with near-zero diff, and makes the authz semantics in `AGENTS.md` carry over unchanged.

## 1. Target architecture

| Layer          | Choice                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Runtime        | Bun (API, worker, scripts)                                                                                                |
| API            | Hono on Bun, REST `/api/v1/*`, Better Auth at `/api/auth/*`                                                               |
| Auth           | Better Auth (email/password), cookie sessions; bearer plugin for future mobile                                            |
| Email          | `ConsoleEmail` (local) / `ResendEmail` (prod), wired into Better Auth's reset + verification hooks                        |
| DB             | PostgreSQL via Drizzle ORM + drizzle-kit                                                                                  |
| Queue          | pg-boss (Postgres-backed; no Redis; same locally and on AWS)                                                              |
| Storage        | Private S3; **presigned PUT** for uploads                                                                                 |
| Media delivery | **Durable same-origin `/media/{objectKey}` proxy**, authz checked per request (no presigned GETs)                         |
| Images         | `sharp` on the server (all variants; no client encoding)                                                                  |
| Local          | Docker Compose (Postgres + MinIO, Mailpit optional) + `bun run dev`                                                       |
| AWS            | CDK: VPC, RDS Postgres, ECR, ECS Fargate (API + worker), S3+CloudFront (media + web), `/api` + `/media` routed to the ALB |
| Web            | Vite + React 19 + Mantine (moved from `./src`)                                                                            |
| Contract       | `packages/shared` — DTOs, Zod schemas, error codes, caps, `photoUrl` ladder (consumed by web + future mobile)             |

## 2. Monorepo layout

```
arcula/
  apps/
    web/                     # Vite/React, moved from ./src
      src/
        lib/auth-client.ts   # Better Auth React client
        lib/api.ts           # fetch wrapper (credentials: include, error mapping)
        services/api/        # collections, artworks, uploads, public, csv
        components/          # existing components, adapted
        hooks/               # useArtworkPhotos/Documents reworked
      tests/  index.html  public/  vite.config.ts  package.json  tsconfig.json
    api/                     # Hono server
      src/
        index.ts             # Bun entry: serve app + (optionally) start the worker
        app.ts               # Hono app, CORS, Better Auth mount, routes
        worker.ts            # pg-boss worker (image processing)
        routes/              # health, me, collections, artworks, uploads, media, public, csv
        services/            # collection, artwork, storage, serialization
        media/               # sharp pipeline + variant geometry (server-only)
      tests/
      Dockerfile
  packages/
    shared/                  # THE CONTRACT: DTOs, Zod schemas, utils, error codes
      src/{types.ts,schemas/,utils/,errors.ts,index.ts}
    db/                      # Drizzle schema + client factory + migrations + seed
  infra/                     # AWS CDK (TypeScript)
  docker-compose.yml         # Postgres, MinIO, Mailpit (optional)
  package.json               # bun workspaces + root scripts
  drizzle.config.ts
```

- `packages/shared` is what a **future mobile client** imports (or mirrors). One package with subpath exports (`@arcula/shared/types`, `/schemas`, `/utils`, `/errors`), splittable later.
- `packages/db` because both the API and the worker share the schema, and splitting the worker into its own ECS service needs it importable without reaching into another app.
- The web move in Phase 0 is `git mv` with **no code edits**, so it stays green against the Firebase emulators until the cutover phase.
- Deleted in the cutover phase: `functions/`, `firebase.json`, `.firebaserc`, `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `firestore-debug.log`, `src/migrations/**`, `MigrationsPage.tsx`, `maintenanceAccess.ts`, `firestoreErrors.ts`, and the `firebase` / `@firebase/*` / `firebase-tools` dependencies. Also delete the unused `VITE_API_URL` / `VITE_USE_NEW_API` env vars — the service-layer swap _is_ the cutover; a dual-backend kill switch would mean maintaining two data layers.

## 3. Data model (Drizzle, corrected)

Better Auth tables: `user`, `session`, `account`, `verification` (defined in Drizzle, managed together, in the same schema object passed to the adapter).

- **`user`** — Better Auth columns (`id` text PK, `name`, `email` unique, `emailVerified`, `image`, timestamps) **plus app fields**: `firstName text`, `lastName text`, `tier text default 'free'`, and a nullable `settings jsonb` for genuinely freeform preferences. Typed columns for anything the app or future features query (tier, billing, filters); jsonb reserved for preferences. This is "our own users table" as requested.
- **`collections`** — `id` uuid PK, `userId`→`user.id` cascade, `name`, `description`, `isPublic bool default true`, `skin text default 'basicx'`, `skinOptions jsonb default '{}'`, `createdAt`, `updatedAt`. Index on `(userId)`. **No `urlizedName`** (slug stays a URL concern, derived from name — rename stays safe).
- **`artworks`** — `id` uuid PK, `collectionId`→`collections.id` cascade, `userId`→`user.id` (denormalized for owner queries), `title NOT NULL`, **`artistName NOT NULL`**, `serie`, `dateOfCreation`, `media`, `dimensions`, `editions`, `acquisitionDate date`, `acquisitionPrice text`, `placeOfOrigin`, `provenance`, `condition`, `currentValue`, `notes`, `isPublic bool default true`, `deletedAt timestamptz NULL`, timestamps. Indexes: `(userId)`, `(collectionId, deletedAt)`.
- **`artwork_photos`** — `id` uuid PK, `artworkId` cascade, `orderIndex int NOT NULL` (index 0 = primary thumbnail, reindexed on every write), `name`, `width`, `height`, `sizeBytes`, `contentType`, **`originalKey`** (S3 key, no URL), `status` (`processing|ready|failed`), `error`, **`variants jsonb`** (`[{key, objectKey, width, height, size, contentType}]`, keys not URLs), timestamps.
- **`artwork_documents`** — same shape, plus `kind` (`file|image`); documents have **no order** (matches current invariant). PDFs are `ready` immediately; images get variants.

**Indexes are Postgres-native, not Firestore-shaped.** `userId` and `isPublic` are filtered in SQL, so the old Firestore composites `(collectionId,userId,deletedAt)` and `(collectionId,isPublic,deletedAt)` are unnecessary; `(collectionId, deletedAt)` plus `collections(userId)` and `artworks(userId)` is enough.

Deliberately dropped: `passwordHash` and `artworks[]` on collections (never written/used), `urlizedName`, and stored URLs. Clearing an artwork field is an explicit `NULL` in the PATCH (the shared schema outputs `null` for cleared optional fields instead of the Firestore `deleteField()` sentinel). Variants stay JSONB rather than a child table: they are a fixed set generated atomically with the photo (an attribute, not an independently-queried entity), and per-entry S3 prefixes already make deletion a known-key operation.

## 4. Auth (Better Auth + Resend)

- Mount `auth.handler(c.req.raw)` at `/api/auth/*` (verify `toWebHandler` / the documented Hono integration at implementation time); auth middleware resolves the session and sets `userId` on the Hono context.
- **Same-origin sessions** to avoid cross-origin cookie pain: Vite dev proxies `/api` and `/media` → `:4000`; CloudFront routes `/api/*` and `/media/*` to the ALB in prod. Cookies become first-party, CORS is trivial, `trustedOrigins` is minimal.
- **Email provider interface**: `ConsoleEmail` locally (logs the reset/verification link, nothing bills) and `ResendEmail` in prod, both wired into Better Auth's `sendResetPassword` / verification hooks.
- Verification is **off during beta** so the seeded account works immediately; reset/verification flows are still built and documented.
- Add Better Auth's **bearer plugin** now (cheap) so a future mobile app authenticates without cookies.
- **Sign-up is required, not optional**: with Firebase gone there is no console to create accounts in, so `/signup` is part of this migration (see §11 Phase 6).
- **Seed** creates exactly one account via `auth.api.signUpEmail` (real hashing), from `SEED_USER_EMAIL/PASSWORD/NAME`. No other data; idempotent create-if-missing.
- **Reset**: `db:reset` drops the `public` schema, re-runs Drizzle migrations, empties the media bucket, and seeds the owner. `db:wipe` is the destructive half, exposed separately. Guarded to refuse production unless `ALLOW_DB_RESET=true`.

## 5. Storage + server-side images + media delivery

**Keys (private bucket, no URLs in DB):**

```
artworks/{userId}/{collectionId}/{artworkId}/photos/{photoId}/original.{ext}
artworks/{userId}/{collectionId}/{artworkId}/photos/{photoId}/{variantKey}.{ext}
artworks/{userId}/{collectionId}/{artworkId}/documents/{docId}/original.{ext}
artworks/.../documents/{docId}/{variantKey}.{ext}
```

Per-entry folders make deletion a list-and-delete on one prefix and make orphans obvious.

**Upload flow (presign → PUT → complete → enqueue):**

1. `POST .../photos/presign` — server mints ids, builds final keys, returns presigned PUT URLs (and validates declared type/size against the allowlist before signing).
2. Client PUTs originals **directly to S3** (no proxying large bodies through the API). Bucket CORS is required: a cross-origin `PUT` always preflights, regardless of headers.
3. `POST .../photos/complete` — server `HEAD`s each object to verify real size/type, inserts rows (`status = processing`), and enqueues a pg-boss job.
4. Worker downloads the original, runs sharp, uploads variants, flips the row to `ready`/`failed`.
5. The `complete` call **awaits the job briefly (bounded timeout) and returns final rows**; if the timeout elapses it returns `202` and the client polls `GET /api/v1/artworks/:id` until `ready`. This keeps the form feeling synchronous in the common case (the variants are ready before save, as the client does today) while staying retry-safe. If we ever want to cut scope, synchronous per-photo processing is a valid fallback.

**sharp details (fixes the prior attempt's bugs):**

- The **server-only** geometry (`IMAGE_VARIANTS`, `variantSize`, `coverCrop`) lives in `apps/api/src/media`, moved over _verbatim_ from `src/utils/imageVariants.ts` so server output matches the web's historical geometry. Shared keeps the _contract_ only: `ImageVariantKey`, the ordered `VARIANT_KEYS`, the `photoUrl` ladder, caps, and accepted types.
- `.rotate()` to apply EXIF orientation (must be explicit; sharp does not auto-rotate).
- `cover` → `resize(w,h,{fit:'cover',position:'centre'})`; `inside` → `withoutEnlargement: true`, never upscales.
- WebP at quality 95 for variants (WebP preserves alpha; no PNG-variant branch needed). Store the **original untouched** with its true content type — never guess from alpha.
- Documents: PDFs stored as-is; document images get `square_sm` + `large` only.

**Media delivery — durable URLs, API-authorized (reverses the earlier presigned-GET answer).** `variants[].url` and `original.url` are serialized as durable, same-origin paths: `/media/{objectKey}`. The API route authorizes per request — owner, or (for a photo) artwork `isPublic && deletedAt == null`; documents are owner-only (403 otherwise, so "never public" is structural, not a convention). This avoids the presigned-GET trap: the client bakes URLs into `srcset` and holds DTOs open, so expiring URLs break `photoUrl`/`photoSrcSet` on refresh and are hostile to mobile sync. CloudFront sits in front for TLS and same-origin; media caching is an optimization, not a v1 requirement — if enabled, **only public responses** may be cached, and a visibility change must invalidate the affected keys (or use a versioned key). Presigned PUT stays for uploads; presigned GET is dropped.

**Safety:** server-side extension/MIME allowlist (`webp|jpg|png`; documents add `pdf`), size caps (10 MiB photos / 25 MiB documents), and deletion of a removed entry's whole prefix.

## 6. API surface

| Method    | Path                                                                 | Auth                                                          |
| --------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| GET       | `/health`                                                            | none (deploy smoke test)                                      |
| ALL       | `/api/auth/*`                                                        | Better Auth (sign-up/in/out, session, reset, change password) |
| GET       | `/api/v1/me` · `PATCH /api/v1/me`                                    | session (profile)                                             |
| GET/POST  | `/api/v1/collections`                                                | owner (POST enforces `COLLECTION_LIMIT`)                      |
| GET       | `/api/v1/collections/:id`                                            | owner or public                                               |
| PATCH     | `/api/v1/collections/:id`                                            | owner                                                         |
| GET       | `/api/v1/collections/:id/artworks`                                   | owner (live only)                                             |
| POST      | `/api/v1/collections/:id/artworks`                                   | owner                                                         |
| POST      | `/api/v1/collections/:id/import`                                     | owner (bulk JSON from client-parsed CSV)                      |
| GET/PATCH | `/api/v1/artworks/:id`                                               | owner or public / owner                                       |
| POST      | `/api/v1/artworks/bulk-soft-delete` · `/api/v1/artworks/:id/restore` | owner                                                         |
| POST      | `/api/v1/artworks/:id/photos/presign` · `/complete`                  | owner                                                         |
| PUT       | `/api/v1/artworks/:id/photos`                                        | owner (reorder + remove-in-one)                               |
| POST/PUT  | `.../documents/...`                                                  | owner                                                         |
| GET       | `/media/*`                                                           | authz per kind (see §5)                                       |
| GET       | `/api/v1/public/collections/:id` · `.../artworks/:artworkId`         | none                                                          |

Validation via `@hono/zod-validator` with schemas from `packages/shared`. REST (not Hono-RPC-only) plus a generated **OpenAPI spec now** — it is the mobile contract, and with `@hono/zod-openapi` it is cheap to produce while the routes are being written. Public endpoints return `403` for a private-but-existing collection (parity with today's "This collection is private.") and `404` for missing.

**Error model:** `{ error: { code, message } }`, with the code table in `packages/shared` (`unauthorized`, `not-found`, `permission-denied`, `invalid-input`, `conflict`, `too-large`, `unsupported-type`, `processing-failed`, …). The client's `firestoreErrors.ts` is replaced by a lookup against that table, including the load-bearing case: visitor-side `permission-denied` maps to the private / not-found states, never a generic error. The `publicCollectionState` union is unchanged.

**CSV import** stays client-parsed and client-reviewed (papaparse); Confirm POSTs the rows to the batch endpoint, which validates with the shared `artworkImport` schema and inserts in **one server-side transaction**.

## 7. Web migration (`./src` → `apps/web`)

**Moved as-is** (pure logic largely survives): `utils/slug.ts`, `utils/artworkPhotos.ts` (operates on DTOs), `utils/artworkDocuments.ts`, `utils/csv.ts`, skins (`src/skins/**`), `theme.ts`, `App.tsx` route table, most Mantine UI.

**Moved to `packages/shared`:** domain DTOs, artwork + import Zod schemas, `ImageVariantKey` + `VARIANT_KEYS`, caps, accepted types, error codes.

**Deleted:** `services/firebase.ts`, `artworkFiles.ts`, `imageService.ts`, `documentService.ts`, `authService.ts`, `collectionService.ts`, `artworkService.ts`; `utils/imageRender.ts`, `imageWorker.ts`, `imageProcessing.ts` (client encoding is gone — this directly satisfies "move thumbnails to the server"); `migrations/**`, `MigrationsPage.tsx`, `firestoreErrors.ts`, `maintenanceAccess.ts`.

**Rewritten:**

- `context/AuthContext.tsx` + `ProtectedRoute` + `LoginPage` + `ManageNavBar` → Better Auth client; `currentUser` is `{ id, email, name }`; `useAuth()` shape preserved so components barely change.
- `ManagePage`, `NewCollectionPage`, `CollectionPage`, `CollectionSettingsPage`, `ArtworksTable`, `CsvImportPage` → `services/api/*`.
- `usePublicCollection.ts` → public API; keep the `PublicState` union and the pure `publicCollectionState`/`publicArtworkState` decisions (map API 403/404 instead of Firestore `permission-denied`).
- `useArtworkPhotos.ts` / `useArtworkDocuments.ts` — the biggest change: pending entries hold a `File` + local object URL only (no client `processed` variants, no WebP probe, no yellow warning). On add → presign → PUT → complete → process; `mergeUploaded` still works against server-returned rows.
- `PhotoUploader` / `DocumentsUploader` → show the local original while uploading/processing, then swap to server URLs.

## 8. Local dev

- `docker-compose.yml`: `postgres:16`, `minio` (+ bucket-init via the AWS SDK if missing). Mailpit is optional; local email defaults to `ConsoleEmail`.
- `bun run dev` runs API + web concurrently; Vite proxies `/api` and `/media` → `localhost:4000`, so cookies and all `fetch('/api/…')` calls are same-origin — **no CORS anywhere locally**.
- Scripts: `db:up`, `db:down`, `db:generate`, `db:migrate`, `db:wipe`, `db:reset`, `db:seed`, `db:studio`, `dev`, `dev:api`, `dev:web`, `check`, `test`, `test:api`, `test:web`, `build`, `deploy`.
- `.env.example`: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `CORS_ORIGINS`, `PORT`, `SEED_USER_EMAIL`, `SEED_USER_PASSWORD`, `SEED_USER_NAME`. (The repo's current `.env` already contains most of these from the earlier attempt; the unused `VITE_*` keys get removed.)

## 9. AWS CDK (`infra/`)

- **vpc** — 2 AZs, public + private subnets, single NAT for dev.
- **db** — RDS PostgreSQL (t4g.micro to start), private subnets, creds in Secrets Manager.
- **storage** — private/versioned S3, CORS for presigned PUT; CloudFront for media (public responses cacheable; invalidation on visibility change).
- **api** — ECR, ECS Fargate cluster, ALB, **one image run as two services**: `api` (`bun run start`) and `worker` (`bun run start:worker`); secrets/env wired; health check `/health`; a one-off `migrate` task run before rollout. Sizing driver is decode + variants: 2 vCPU / 8 GiB is a reasonable start.
- **web** — S3 static + CloudFront, with `/api/*` and `/media/*` behaviors to the ALB so auth is same-origin; SPA fallback to `index.html`.
- `Dockerfile.api` — multi-stage `oven/bun`, non-root, sharp-compatible.
- CI (GitHub Actions): check + test (Postgres service) → build/push image → run migrations → `cdk deploy`.
- _(Alternative considered from QWEN: a single Fargate service that also serves the SPA from the image. Simpler, but couples web deploys to the API image and forgoes a CDN. Kept as a fallback, not the default.)_

## 10. Testing — porting map

Same doctrine as `AGENTS.md`: **would this test fail if _we_ changed something, or only if a library changed?** Tier 1 (pure logic over our own data) and Tier 2 (our value going into the library, where the failure is invisible in review or a screenshot) survive; the rest go. Mutation testing remains the acceptance bar for anything new.

| Today                                                                                                                                         | After                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/imageVariants` (pure geometry)                                                                                                         | → `apps/api/tests` (pure logic, preserved; geometry is now server-only)                                                                                                                                                      |
| `tests/imageProcessing`                                                                                                                       | probe / canvas / worker cases **deleted** (no probe, no worker client-side); the decode-variant arithmetic survives in `apps/api/tests`                                                                                      |
| `tests/artworkPhotos` (order invariant)                                                                                                       | → `packages/shared/tests` — both sides still rely on it                                                                                                                                                                      |
| `tests/firestore.rules.test`                                                                                                                  | → `apps/api/tests`: the same _semantic_ cases (owner / visitor / soft-delete / public) re-expressed as service-layer tests against dockerized Postgres                                                                       |
| `tests/storage.rules.test`                                                                                                                    | → `apps/api/tests`: accepted types / size / extension, path shape, **the `.bin` regression stays covered** (real document service + real `File`, now against MinIO)                                                          |
| `tests/artworkImport`, `csv`, `artworkDocuments`, `artworkWarnParam`, `photoUploader`, `documentsUploader`, `artworkAddPage`, `artworksTable` | → `apps/web/tests`, adapted to mock the **API client** instead of Firestore services                                                                                                                                         |
| `tests/skinHost`, `skinRegistry`, `skinOptions`, `basicxSkin`, `publicCollectionPage`, `publicArtworkPage`, `publicCollectionState`           | → `apps/web/tests`, essentially unchanged (skins are presentation; only the data-fetching mock changes). `skinHost` stays load-bearing: it is the only test that fails if `cssVariablesSelector` is ever set back to `:root` |
| `maintenanceAccess` + `MigrationsPage`                                                                                                        | **deleted**                                                                                                                                                                                                                  |
| — (new)                                                                                                                                       | auth flows (signUp / signIn / reset), collection cap, seed smoke, users profile, media authz (owner / public / document-403)                                                                                                 |

## 11. Phased execution

Each phase ends green: `check` (tsc + eslint + prettier) plus all tests for everything in place at that point.

| Phase                   | Scope                                                                                                                                                                                                                                                                                                                                                                                          | Done when                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0 — Restructure**     | Bun workspaces; `git mv` web → `apps/web` (tests included); `packages/shared` skeleton (types / schemas / utils / errors); `packages/db` skeleton; `docker-compose.yml` + env. **No behavior changes.**                                                                                                                                                                                        | `bun run dev` runs the app exactly as today (Firebase emulators); import paths are the only diff; the full existing suite passes.                                                                      |
| **1 — DB + scripts**    | Drizzle schema (auth + corrected app tables); first migration; `db:generate/migrate/reset/seed/wipe`; seed one account.                                                                                                                                                                                                                                                                        | `db:reset` produces a seeded DB; seed is idempotent; migrations apply cleanly.                                                                                                                         |
| **2 — Auth foundation** | Better Auth + Drizzle adapter, email provider interface (`ConsoleEmail`/`ResendEmail`), bearer plugin, auth middleware, CORS, typed config, `/health`, `/me`; same-origin proxy.                                                                                                                                                                                                               | signUp / signIn / signOut work over HTTP with a session cookie; reset mail is emitted by the provider.                                                                                                 |
| **3 — Shared contract** | Move DTOs, Zod schemas, key/caps/error tables into `packages/shared`; web imports updated, behavior unchanged.                                                                                                                                                                                                                                                                                 | web still runs on Firebase, now importing the contract from `@arcula/shared`.                                                                                                                          |
| **4 — Data endpoints**  | Collections + artworks CRUD, owner/public list split, soft-delete/restore, batch, public reads, authz middleware, error model, CSV bulk in one transaction; port the rules-suite semantics to API tests.                                                                                                                                                                                       | all ported rules cases pass against dockerized Postgres; the API is fully testable without the web client.                                                                                             |
| **5 — Media pipeline**  | S3 client/presigner, staging → promote, sharp processor (geometry moved verbatim, `.rotate()`, WebP 95), pg-boss queue + worker, presign/complete/sync routes, `/media` proxy, `status` lifecycle, prefix deletion; port storage-suite cases.                                                                                                                                                  | a 12 MP photo → 5 WebP variants in MinIO; the proxy renders them for owner + public, refuses documents to visitors; a PDF round-trips; the `.bin` regression test stays red-if-broken.                 |
| **6 — Account + email** | `/signup` page; `/manage/profile`; forgot-password on `/login`; collection cap (`COLLECTION_LIMIT`, default 1) enforced in `POST /api/v1/collections`.                                                                                                                                                                                                                                         | sign up → (mailable) → change password; profile writes typed columns; the cap is enforced.                                                                                                             |
| **7 — Web cutover**     | services → `apiClient`; `AuthContext` → Better Auth client (same `useAuth()` shape); `LoginPage` error mapping; uploader hooks reworked; public pages/skins; CSV confirm; **delete** `firebase.ts`, `authService`, `imageService`, `artworkFiles`, `imageWorker`/`imageProcessing`/`imageRender`, `migrations/*`, `firestoreErrors`, `maintenanceAccess`, `MigrationsPage`, all Firebase deps. | the full journey works with **no Firebase anywhere**: sign in → create collection → add 10 photos → edit/reorder/delete → CSV import → public skin view → visitor read; `check` + all web tests green. |
| **8 — Tests**           | Port/delete/add per §10; wire `test:api` / `test:web`.                                                                                                                                                                                                                                                                                                                                         | the porting map is complete; new auth/cap/media cases exist.                                                                                                                                           |
| **9 — Docker + CDK**    | Dockerfile; CDK stacks (vpc, db, storage/media, api + worker, web + CloudFront path routing); migration task; deploy script; CI.                                                                                                                                                                                                                                                               | `bun run deploy` brings the site up end-to-end on AWS; local and prod run the same code paths.                                                                                                         |
| **10 — Cleanup + docs** | Delete Firebase config/deps/rules/emulators/`functions/`/old root `src` + `tests`; rewrite `AGENTS.md` (Firebase doctrine → API doctrine, keeping the What-to-test philosophy); update `README.md`, `project-plan.md`; retire `RENAME.md` Firebase notes.                                                                                                                                      | the repo contains no Firebase.                                                                                                                                                                         |

Roughly **10–12 focused days**.

## 12. Risks / flags

- **Cross-origin cookies** are the classic Better Auth trap — solved by the same-origin proxy/CloudFront behavior.
- **Sharp on Bun** — works in practice, but mixed reports. First fallback: a Debian-slim base (`oven/bun` on Debian) rather than alpine; second fallback: `@img/sharp-wasm32` (pure WASM, guaranteed on Bun, slower — acceptable since encoding is off the interactive path).
- **Better Auth drizzle adapter gotcha** — custom/extra columns must exist in the schema object passed to the adapter, or sign-up fails opaquely. Define every column (core + app fields) before first run, and make a signUp round-trip part of Phase 2's acceptance.
- **Presigned PUT cannot enforce `content-length-range`** (that needs a POST policy). Mitigation: verify real size/type with `HEAD` on `complete` and reject.
- **The prior-branch off-by-one** — `orderIndex` must start at 0 for a fresh artwork and be reindexed from array position on every write; a test pins `[0,1,2]`.
- **Orphans** — staging prefix + bucket lifecycle expiry, then promote to the final key on `complete`.
- **CDN staleness** — if public media is cached at CloudFront, a visibility change must invalidate the affected keys or the key must be versioned. v1 can serve media uncached through the proxy and add caching later.
- **Zod must be v4 everywhere** (the prior attempt split 3/4 across the workspace).
- **Runtime divergence** — same runtime (Bun) local and prod.
- **Parity kept**: soft delete + restore, per-artwork `isPublic`, `order` invariant, never-upscale variants, CSV date heuristics, private vs notFound states, screen-level UX.
- **Preserved gaps (unchanged scope)**: collection password protection stays unenforced (now implementable server-side, but out of scope); no trash/restore UI; no collection delete UI.

## 13. Decisions log

Adopted from QWEN (with the review's verdict):

1. **Wire-shape parity** with today's documents (`url` = durable path). _Adopted as a guiding principle._
2. **Durable same-origin `/media/{key}` proxy** instead of presigned GETs. _Adopted; reverses the earlier answer._
3. **Postgres-native indexes** (drop the two Firestore composites). _Adopted._
4. **`{ error: { code, message } }`** + shared code table. _Adopted._
5. **CSV import as one transaction.** _Adopted._
6. **The test porting map.** _Adopted in place of the higher-level version._
7. **Phase 0 = pure `git mv`, existing suite green.** _Adopted._
8. **Sign-up + profile + one-collection cap folded into the migration.** _Adopted (cap is a product toggle, default 1)._
9. **`ConsoleEmail` / `ResendEmail` provider interface.** _Adopted; Mailpit optional._
10. **Risk register: Sharp-on-Bun, Better Auth adapter gotcha.** _Adopted._
11. **Server-only image geometry; shared holds the contract.** _Adopted._
12. **`/restore` endpoint and `db:wipe` separated from `db:reset`.** _Adopted._

Rejected or amended from QWEN:

1. **"PUT without `Content-Type` avoids a preflight" — factually wrong.** A cross-origin `PUT` always preflights; bucket CORS is required.
2. **`profile: jsonb` as the primary user store — rejected.** Drizzle migrations make typed columns cheap, and a jsonb blob gives up the type-safety/queryability Postgres is for. Typed columns + nullable `settings jsonb` only.
3. **A normalized `artwork_photo_variants` table — rejected** (and internally inconsistent with QWEN's own jsonb documents). Variants stay JSONB.
4. **Ignoring the existing `hono-api` branch — not done here.** We take its CDK/packages layout as reference and its pitfalls as lessons (EXIF `.rotate()`, Zod versions).
5. **Synchronous per-photo processing — kept as a fallback, not the default.** pg-boss remains, with an awaited-with-timeout UX so the form feels synchronous.
6. **Single Fargate service serving the SPA — kept as a fallback.** Default is S3+CloudFront web with `/api` + `/media` to the ALB.

Final decisions carried in (from the comparison):

| #   | Decision          | Choice                                                                                 |
| --- | ----------------- | -------------------------------------------------------------------------------------- |
| 1   | Media delivery    | Durable same-origin `/media/{key}` proxy, authz per request; presigned PUT for uploads |
| 2   | Deploy shape      | S3+CloudFront web, `/api` + `/media` → ALB; one image runs `api` or `worker`           |
| 3   | Users store       | Typed columns + optional `settings jsonb` (not a jsonb profile bag)                    |
| 4   | Variants          | JSONB on the photo/document row (not a variant table)                                  |
| 5   | Processing        | pg-boss queue, `complete` awaits with a timeout then falls back to polling             |
| 6   | Scope             | Include `/signup` + `/manage/profile`; `COLLECTION_LIMIT` constant (default 1)         |
| 7   | `packages/shared` | One package with subpath exports, splittable later                                     |
| 8   | OpenAPI           | Generate now (it is the mobile contract)                                               |

Open questions for the operator (not blockers): the ACM certificate / Route 53 alias for `arcula.art`, and whether the one-collection cap should ship on or off at launch.

---

I'd like your sign-off on this before writing any code.
