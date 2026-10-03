# API Migration Plan — Firebase → Hono + Drizzle + PostgreSQL + S3 + Better Auth + Resend

> Status: **proposed, not yet implemented.** This document is the review
> copy of the migration plan. It was written against the state of the
> repository on 2 Oct 2026, and every claim about current behaviour was
> verified against the code, `AGENTS.md`, `project-plan.md`, and the test
> suite — not against memory.
>
> Companion documents: `AGENTS.md` (current architecture doctrine),
> `project-plan.md` (current product plan — §"Planned: the beta release"
> is absorbed into Phase 4 below), `RENAME.md` (product is **Arcula**;
> the Firebase project name `custodia-67307` still appears in this
> repository's internal identifiers).

---

## 0. Ground rules

From the migration brief:

- **Monorepo**, bun workspaces. Everything — web client, API, shared
  contract, CDK — lives in this repository.
- **Assume an empty database.** No data migration, no Firebase-UID
  mapping. The current Firebase project contains test data only.
- **Our own `users` table.** We will start adding data to Users soon, and
  adding fields should not require schema surgery every time.
- **Wipe + seed must be one script.** Seeding is minimal: only creating an
  account for the owner with email/password.
- **Local: `bun run dev` runs the full stack.** **Deploy: AWS CDK.**
- **Future mobile clients** will connect to and consume the same API.
  The API is the product boundary; the web client is client #1.
- The current web client (`src/`) is moved/copied and adapted to call the
  new API instead of Firebase.

### Guiding principle

Keep the **client contract stable** and move the **work server-side**.
Every design decision below was chosen to minimize the diff in the web
client and in the existing test suite, and to make the authz semantics
documented in `AGENTS.md` carry over unchanged.

---

## 1. Key design decisions

| Decision                              | Choice                                                                                                                                                                                  | Rationale                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API style                             | Plain JSON routes under `/api`, resource-oriented, no RPC                                                                                                                               | Same resource model as the current service layer (`collectionService` / `artworkService`); trivial to consume from any client                                                                                                                                                                                  |
| API response shapes                   | **Identical JSON to the Firestore documents** (`Artwork`, `ArtworkPhoto.variants[]`, `ArtworkDocument`, …)                                                                              | Client serializers, `photoUrl` / `photoSrcSet`, `sortPhotos`, the skins, and most component tests keep working with near-zero diff. The only shape change: `url` becomes a same-origin **proxy path**, not a Storage URL                                                                                       |
| Auth                                  | Better Auth `emailAndPassword`, mounted at `/api/auth/*`, cookie session                                                                                                                | `@better-auth/react` client keeps the `useAuth()` contract; sign-up and reset are native endpoints — the `auth/requires-recent-login` re-authentication dance from `project-plan.md` §2 disappears                                                                                                             |
| `users` table                         | Better-auth core columns + a **`profile: jsonb`** bag                                                                                                                                   | "We will start adding data to Users soon" — a jsonb bag means new profile fields are _data_, not schema migrations. Better Auth's drizzle adapter supports custom fields; the known gotcha (custom fields must exist in the schema object you pass) is handled by defining them in the drizzle schema up front |
| IDs                                   | `text` (nanoid) everywhere, including Better Auth's tables                                                                                                                              | Lowest-risk choice for the drizzle adapter; keeps id shapes familiar (Firestore doc ids were also opaque text)                                                                                                                                                                                                 |
| Thumbnails                            | **Server-side, Sharp.** Original uploaded once (presigned PUT); variants generated per photo in a `process` step                                                                        | The WebP-probe and the entire silent-downgrade class of bug _disappears_ — Sharp always encodes WebP. `variantSize` / `coverCrop` move over verbatim; the never-upscale `fit: "inside"` rule is preserved                                                                                                      |
| Image reads                           | **API proxy** (`GET /api/media/…`), authz checked per request, stream from S3                                                                                                           | Stable URLs that never expire (presigned GETs would break the `photoUrl` ladder on refresh); works identically for a mobile client; documents stay never-public because the proxy 403s non-owners                                                                                                              |
| Extension story                       | Originals stored in their own format (keeps PNG alpha); variants `.webp`; PDFs as-is                                                                                                    | Supersedes the client's probe / `extensionFor` machinery                                                                                                                                                                                                                                                       |
| CSV import                            | Client still parses + reviews in-browser (papaparse); **Confirm POSTs the rows** to a batch endpoint; the server validates with the same shared Zod schema and inserts in a transaction | Preserves the entire review UX; the chunk-of-400 `writeBatch` semantics are replaced by one server-side transaction                                                                                                                                                                                            |
| Authz                                 | Rules semantics re-implemented in the API service layer (`userId` owner checks, `isPublic`, `deletedAt == null`)                                                                        | The documented semantics of `firestore.rules` / `storage.rules` carry over 1:1 — they are _our_ logic, which the test doctrine says to keep testing                                                                                                                                                            |
| Collection cap (`project-plan.md` §1) | **Enforced in the API** (`count < COLLECTION_LIMIT` on create)                                                                                                                          | Postgres can count; the whole "Firestore rules can't count documents" problem vanishes                                                                                                                                                                                                                         |
| Migrations machinery                  | **Deleted.** Drizzle migrations + the empty-DB assumption make `MigrationsPage`, `src/migrations/*`, and `maintenanceAccess` obsolete                                                   | The doctrine they existed for (backfilling legacy documents) no longer applies                                                                                                                                                                                                                                 |
| Email                                 | Provider interface: `ConsoleEmail` (local) / `ResendEmail` (prod), wired into Better Auth's `sendResetPassword` / `sendVerificationEmail` config hooks                                  | Nothing local bills; prod uses Resend exactly as requested                                                                                                                                                                                                                                                     |

### Notes on deletions

`functions/` is a dead scaffold — it exports nothing and nothing in `src/`
calls or depends on it at runtime. Its only content is a design note for
password-protected collections (FULLSPEC §9), which is preserved as
optional Phase 7.

The `VITE_API_URL` / `VITE_USE_NEW_API` variables already sitting in
`.env` (currently referenced by nothing in the code): **delete.** The
service-layer swap _is_ the cutover; a dual-backend kill switch would mean
maintaining two data layers for the duration of the migration. (Open
question 2 below if this is contested.)

---

## 2. Repository layout

```
arcula/
  package.json            private, workspaces: ["apps/*", "packages/*"], all scripts
  .env / .env.example     (VITE_* + local-infra vars; no secrets committed)
  AGENTS.md, README.md, RENAME.md, project-plan.md   (updated in the final phase)
  docker-compose.yml      postgres:16 + minio
  .gitignore, .prettierignore, eslint.config.mjs
  apps/
    web/                  current Vite + React client, moved here verbatim (git mv)
      src/  tests/  index.html  public/  vite.config.ts  package.json  tsconfig.json
    api/                  Hono + Drizzle + Better Auth + Sharp + S3 + Resend
      src/
        index.ts          (Bun.serve({ fetch: app.fetch, port: 8080 }))
        app.ts            (Hono app: routes, middleware, static-file fallback)
        auth.ts           (createAuthServer config)
        schema.ts         (drizzle pg-core: all tables, domain + better-auth)
        services/         (collectionService, artworkService, mediaService, userService)
        media/            (variantSize, coverCrop, encode pipeline — Sharp)
        errors.ts
      drizzle/            (generated migrations + meta)
      tests/
      Dockerfile
      package.json  tsconfig.json
  packages/
    shared/               THE CONTRACT:
      src/
        types.ts          (User, Collection, Artwork, ArtworkPhoto, ArtworkDocument,
                           ImageVariant, ImageVariantKey — same JSON shapes as today)
        schemas/          (artwork.ts, artworkImport.ts, user.ts — Zod)
        utils/            (slug, sortPhotos, reindexPhotos, sortDocuments, photoUrl,
                           caps: MAX_ARTWORK_PHOTOS / MAX_ARTWORK_DOCUMENTS, MAX_*_BYTES)
        errors.ts         (shared error-code table)
      tests/
  infra/
    bin/arcula.ts         (cdk app entry)
    lib/ArculaStack.ts
    package.json  tsconfig.json  cdk.json
```

- `packages/shared` is what a **future mobile client** imports (or
  mirrors). Everything both sides must agree on — types, validation
  schemas, caps, error codes, the `photoUrl` ladder — lives here.
  `variantSize` / `coverCrop` are _server-only_ concerns and stay in
  `apps/api`, deliberately **not** in shared.
- The move is `git mv` with no code edits in the move itself, so Phase 0
  leaves the app running exactly as it does today (still against the
  Firebase emulators).
- Deleted in the cutover phase: `functions/`, `firebase.json`,
  `.firebaserc`, `firestore.rules`, `storage.rules`,
  `firestore.indexes.json`, `firestore-debug.log`, and the
  `@firebase/*` + `firebase-tools` dependencies.

---

## 3. Database schema (Drizzle, pg-core)

All ids are `text`. All tables carry `createdAt` / `updatedAt`
timestamptz, server-stamped by the service layer — the same discipline as
today's `serverTimestamp()`-last rule (which the old rules verified
against `request.time`).

| Table                    | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                  | `id`, `email` (unique, not null), `name` (nullable), `profile` (**jsonb**, nullable), `createdAt`, `updatedAt` — plus Better Auth's `session` and `account` tables, with the exact column names the drizzle adapter expects (`passwordHash` / `salt` on `account` for `emailAndPassword`). All of these are defined in the _same_ schema object that is passed to the adapter — the adapter requires finding its tables inside the schema you pass |
| `collections`            | `id`, `userId`, `name`, `description?`, `isPublic` (default `true`), `skin?`, `skinOptions` (jsonb), `passwordHash?` (optional phase), `createdAt`, `updatedAt`                                                                                                                                                                                                                                                                                    |
| `artworks`               | `id`, `collectionId`, `userId`, `title`, `artistName`, `serie?`, `dateOfCreation?`, `media?`, `dimensions?`, `editions?`, `acquisitionDate?`, `acquisitionPrice?` (text, as today — nothing does arithmetic on it), `placeOfOrigin?`, `provenance?`, `notes?`, `condition?`, `currentValue?`, `isPublic` (default `true`), `deletedAt?` (nullable = live), `createdAt`, `updatedAt`                                                                |
| `artwork_photos`         | `id`, `artworkId`, `order`, `name`, `size`, `contentType`, `width`, `height`, `originalObjectKey`, `createdAt`                                                                                                                                                                                                                                                                                                                                     |
| `artwork_photo_variants` | PK `(photoId, key)` → `objectKey`, `width`, `height`, `size`, `contentType`                                                                                                                                                                                                                                                                                                                                                                        |
| `artwork_documents`      | `id`, `artworkId`, `kind` (`'file'                                                                                                                                                                                                                                                                                                                                                                                                                 | 'image'`), `name`, `size`, `contentType`, `objectKey`, `variants`(jsonb, image kind only),`createdAt` |

- Photos and documents are **relational, not embedded**. Variants become
  rows, so deletion is a row delete + S3 object delete with no `listAll`
  scan, and a mobile client can query them directly.
- **Response serialization re-embeds** the rows into the legacy JSON
  shape (`original: {url, size, contentType}` where `url` is the proxy
  path; `variants: [{key, url, …}]`), so the client is unchanged.
- Indexes: `users(email)` unique; `collections(userId)`;
  `artworks(collectionId)`, `artworks(userId)`,
  `artworks(collectionId, deletedAt)`; `artwork_photos(artworkId)`;
  `artwork_documents(artworkId)`. The `isPublic` clause is folded into the
  service queries (Postgres can AND/OR it in-SQL); the two documented
  Firestore composites survive only as the `(collectionId, deletedAt)`
  index.
- **Wipe/seed:** `db:reset` = drop schema + `drizzle-kit migrate` + empty
  the media bucket + seed the owner account. Seed calls the _same_ Better
  Auth `signUp` instance the app uses, so the password hash is guaranteed
  compatible. `db:wipe` is the destructive half, exposed separately.
  `db:seed` is idempotent (create-if-missing).

---

## 4. API surface (Hono)

Mounting: `app.route("/api/auth/*", webHandler)` where
`webHandler = toWebHandler(auth)` — Better Auth is framework-agnostic and
emits standard `Request → Response`, which is exactly what Hono wants.
(Verified: `toWebHandler` exists in current Better Auth and is the
documented integration path for arbitrary web-standard servers.)

| Route                                                                                                 | Access                   | Notes                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                                                                                     | public                   | deploy smoke test                                                                                                                                                                                                                                                                   |
| `/api/auth/*`                                                                                         | —                        | Better Auth: `signUp.email`, `signIn.email`, `signOut`, `session`, `forgotPassword`, `changePassword`, `resetPassword`                                                                                                                                                              |
| `GET /api/collections`                                                                                | session                  | owner's live collections (replaces `ManagePage`'s direct SDK query — fixes the documented service-layer inconsistency)                                                                                                                                                              |
| `POST /api/collections`                                                                               | session                  | cap check (`COLLECTION_LIMIT`, default 1 in beta, constant in `shared`); writes the documented defaults (`isPublic: true`, explicit-null `deletedAt`-equivalents)                                                                                                                   |
| `GET /api/collections/{id}` · `PATCH /api/collections/{id}`                                           | session (owner) / public | PATCH accepts the same field set as `CollectionUpdate` **without** `deleteField` sentinels — a plain patch with absent-keys-meaning-unchanged is enough in SQL; clearing a value is an explicit `null`                                                                              |
| `GET /api/public/collections/{id}` / `…/artworks` · `GET /api/public/artworks/{id}`                   | public                   | semantics = the old visitor rules: `isPublic && deletedAt == null`. **Denied reads surface as 404/private states on the client**, never a generic error — the `publicCollectionState` union is unchanged, including the "private is not an error" doctrine                          |
| `GET/POST /api/collections/{id}/artworks`                                                             | session                  | owner list (live only) / single create                                                                                                                                                                                                                                              |
| `POST /api/collections/{id}/artworks:batch`                                                           | session                  | CSV-import commit: validates rows with the shared `artworkImport` schema, inserts in one transaction, returns `{created, failed[]}`                                                                                                                                                 |
| `GET/PATCH /api/artworks/{id}`                                                                        | session (owner)          | —                                                                                                                                                                                                                                                                                   |
| `POST /api/artworks/{id}/soft-delete` · `/api/artworks/{id}/restore`                                  | session (owner)          | `deletedAt` stamped / cleared — soft-delete semantics preserved exactly, including the "restore is a write of explicit null, never a field deletion" rule                                                                                                                           |
| `POST /api/artworks/{id}/photos/presign`                                                              | session (owner)          | `{name, contentType, size}` → validates (type / size / extension allowlist — the old `storage.rules` checks, including the never-widen-the-allowlist XSS rule) → `{photoId, presignedPutUrl, objectKey, expiresAt}`                                                                 |
| `POST /api/artworks/{id}/photos/{photoId}/process`                                                    | session (owner)          | server decodes the S3 original (Sharp), generates the 5 photo variants (or `square_sm` + `large` for document images), writes the rows, returns the finished `ArtworkPhoto` shape                                                                                                   |
| `PATCH /api/artworks/{id}` (save)                                                                     | session (owner)          | payload: form fields + ordered `photoIds[]` + `documentIds[]` → writes/updates rows, **sweeps deleted** photos/documents (row delete + S3 delete from the stored `objectKey` — no name reconstruction, no `listAll`), reindexes `order` (`reindexPhotos`), returns the full artwork |
| `GET /api/media/{objectKey…}`                                                                         | authz per kind           | streaming proxy. Photos: owner, or (artwork `isPublic` and `deletedAt == null`). Documents: **owner only** (403 otherwise — the old "never public" rule, now structural)                                                                                                            |
| `GET/PATCH /api/users/me`                                                                             | session                  | profile read / `profile` jsonb patch                                                                                                                                                                                                                                                |
| _(optional phase)_ `POST /api/collections/{id}/password` · `POST /api/public/collections/{id}/unlock` | session / session        | FULLSPEC §9 password protection (see Phase 7)                                                                                                                                                                                                                                       |

**Error model:** `{ error: { code, message } }`, with the code table in
`shared` (`unauthorized`, `not-found`, `permission-denied`,
`invalid-input`, `conflict`, `too-large`, `unsupported-type`,
`processing-failed`, …). The client's `firestoreErrors.ts` is replaced by a
lookup against that table — including the load-bearing case: **visitor-side
`permission-denied` maps to the "private / not found" states**, never a
generic error.

**Upload/preview flow** (keeps the current UX, moves the work): on the
Add page, for each dropped file: `presign` → `PUT` the original to S3 →
`process` (concurrency 3, as today) → the entry now holds real
server-rendered variants, so the tile **and** the preview modal show the
same images a saved photo will have. Save is then a fast bookkeeping
PATCH. The Edit page follows the same pattern, minus adds.

---

## 5. Local development

- `docker-compose.yml`: `postgres:16` (5432) + `minio` (9000/9001).
  Credentials in `.env`; bucket creation is done by `db:up` via the AWS
  SDK (endpoint override + path-style) if the bucket doesn't exist.
- Env vars: `DATABASE_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `S3_BUCKET`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`
  (optional — the local email provider is console/no-op),
  `SEED_EMAIL` / `SEED_PASSWORD`, `VITE_API_TARGET` (proxy target).
- Ports: web **3000** (kept), api **8080**; `vite.config.ts` gains
  `server.proxy['/api'] → localhost:8080`, so cookies and all
  `fetch('/api/…')` calls are same-origin — **no CORS anywhere locally.**
- Scripts (root `package.json`): `dev` (concurrently: api + web),
  `dev:api`, `dev:web`, `db:up`, `db:wipe`, `db:seed`, `db:reset`,
  `test` / `test:api` / `test:web`, `check`, `build`, `deploy`.
- API dev server: `Bun.serve({ port: 8080, fetch: app.fetch })` — the
  documented Hono-on-Bun pattern.

---

## 6. AWS deployment (CDK)

`infra/lib/ArculaStack.ts` — one stack (the monolith), all components in
it:

| Component               | Config                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VPC**                 | created in-stack (or accept an existing VPC ARN via context)                                                                                                                                                                                                                                                                                                         |
| **RDS PostgreSQL 16**   | `db.t4g.medium`, gp3, no multi-AZ to start, 7-day backup, deletion protection; password in SecretsManager                                                                                                                                                                                                                                                            |
| **S3 media bucket**     | single bucket; object-key convention **unchanged** (`artworks/{userId}/{collectionId}/{artworkId}/photos/…`); public access blocked; no versioning to start                                                                                                                                                                                                          |
| **SecretsManager**      | db password, `RESEND_API_KEY`, `BETTER_AUTH_SECRET`; task role gets `GetSecretValue`                                                                                                                                                                                                                                                                                 |
| **ECS Fargate service** | 2 vCPU / 8 GiB (12 MP decode + 5 variants is the sizing driver); task role: S3 on the media bucket + secrets + CloudWatch Logs. **Single service serves everything** — the container serves the SPA as well as the API (static build copied into the image; Hono static middleware), so one domain, one target group, same-origin cookies, zero extra infrastructure |
| **ALB**                 | internet-facing; 443 (ACM cert, configurable) with 80→443 redirect; all paths to the one target group — the app's catch-all decides static vs API                                                                                                                                                                                                                    |
| **CloudWatch Logs**     | for the service                                                                                                                                                                                                                                                                                                                                                      |

Deploy flow (`deploy` script): build web (`vite build`) → build API image
(Dockerfile, web dist baked in) → ECR push → `cdk deploy` → (optional)
Route 53 alias for `arcula.art`. `cdk deploy` keeps `--require-approval`
by default; a separate `deploy:autonomous` passes
`--require-approval never` once the stack is trusted.

Billable surfaces, for reference: Fargate, RDS, S3, ALB. Nothing local
bills.

---

## 7. Testing — porting map

Same doctrine as `AGENTS.md`: **would this test fail if _we_ changed
something, or only if a library changed?** Tier 1 (pure logic over our own
data) and Tier 2 (our value going into the library, where the failure is
invisible in review or a screenshot) survive; the rest go.

| Today                                                                                                                                         | After                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/imageVariants` (pure geometry)                                                                                                         | → `apps/api/tests` (pure logic, kept verbatim)                                                                                                                                                                               |
| `tests/imageProcessing`                                                                                                                       | probe / canvas / worker cases **deleted** (no probe, no worker server-side); the decode-variant arithmetic survives in `apps/api/tests`                                                                                      |
| `tests/artworkPhotos` (order invariant)                                                                                                       | → `packages/shared/tests` — both sides still rely on it                                                                                                                                                                      |
| `tests/firestore.rules.test`                                                                                                                  | → `apps/api/tests`: the same _semantic_ cases (owner / visitor / soft-delete / public) re-expressed as service-layer tests against dockerized Postgres                                                                       |
| `tests/storage.rules.test`                                                                                                                    | → `apps/api/tests`: accepted types / size / extension, path shape, **the `.bin` regression stays covered** (real `documentService` + real `File`, now against MinIO — the case that fails the way production originally did) |
| `tests/artworkImport`, `csv`, `artworkDocuments`, `artworkWarnParam`, `photoUploader`, `documentsUploader`, `artworkAddPage`, `artworksTable` | → `apps/web/tests`, adapted to mock the **API client** instead of Firestore services                                                                                                                                         |
| `tests/skinHost`, `skinRegistry`, `skinOptions`, `basicxSkin`, `publicCollectionPage`, `publicArtworkPage`, `publicCollectionState`           | → `apps/web/tests`, essentially unchanged (skins are presentation; only the data-fetching mock changes). `skinHost` stays load-bearing: it is the only test that fails if `cssVariablesSelector` is ever set back to `:root` |
| `maintenanceAccess` + `MigrationsPage`                                                                                                        | **deleted**                                                                                                                                                                                                                  |
| — (new)                                                                                                                                       | auth flows (signUp / signIn / reset), collection cap, seed smoke, users profile                                                                                                                                              |

Mutation testing remains the acceptance bar for anything new.

---

## 8. Phases

Each phase ends green: `check` (tsc + eslint + prettier) plus all tests
for everything in place at that point.

| Phase                   | Scope                                                                                                                                                                                                                                                                                                                                                                                                                 | Done when                                                                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Restructure**     | workspaces; `git mv` web → `apps/web`, tests moved; `packages/shared` (types / schemas / utils / errors); `docker-compose.yml` + env. **No behavior changes.**                                                                                                                                                                                                                                                        | `bun run dev` runs the app exactly as today (Firebase emulators); import paths are the only diff; the full existing suite passes                                                                      |
| **1 — API skeleton**    | Hono app + `Bun.serve`; drizzle schema + first migration; Better Auth (email+password, drizzle adapter, session cookie); `db:up` / `db:reset` / seed; `GET /api/health`                                                                                                                                                                                                                                               | `db:reset` produces a seeded DB; seed is idempotent; signUp / signIn / signOut work over HTTP with a session cookie                                                                                   |
| **2 — Data endpoints**  | collections + artworks CRUD, soft-delete/restore, batch, public reads, authz middleware, error model; port the rules-suite semantics to API tests                                                                                                                                                                                                                                                                     | all ported rules cases pass against dockerized Postgres; the API is fully testable without the web client                                                                                             |
| **3 — Media pipeline**  | S3 presign, Sharp `process`, 5 variants / document subset, proxy reads, delete sweeps; port storage-suite cases; rewrite `useArtworkPhotos` / `useArtworkDocuments` internals (no worker, no probe, no local processing)                                                                                                                                                                                              | a 12 MP photo → 5 WebP variants in MinIO; the proxy renders them; a PDF document round-trips; the `.bin` regression test stays red-if-broken                                                          |
| **4 — Account + email** | Resend provider (console locally); reset/verification mails; `/signup` page; `/manage/profile` page (project-plan beta items 2–3 — now near-free with Better Auth); forgot-password link on `/login`                                                                                                                                                                                                                  | sign up → verify (mailable) → change password; profile writes to `users.profile`                                                                                                                      |
| **5 — Web cutover**     | services → `apiClient`; `AuthContext` → `better-auth/react` (same `useAuth()` shape); `LoginPage` error mapping; `?warn` param and CSV-confirm re-pointed at the API; **delete** `firebase.ts`, `authService`, `imageService`, `artworkFiles`, `imageWorker`/`imageProcessing`/`imageRender`, `migrations/*`, `firestoreErrors`, `maintenanceAccess`, `MigrationsPage`, `VITE_USE_NEW_API`, all firebase dependencies | the full journey works with **no Firebase anywhere**: sign in → create collection → add 10 photos → edit/reorder/delete → CSV import → public skin view → visitor read; `check` + all web tests green |
| **6 — Deploy + docs**   | CDK stack; Dockerfile; `deploy` script; delete `functions/` + firebase config files; **rewrite `AGENTS.md`** (Firebase doctrine → API doctrine, keeping the What-to-test philosophy); update README / project-plan / RENAME (package names → `arcula*`)                                                                                                                                                               | `bun run deploy` brings the site up end-to-end on AWS; local and prod run the same code paths; the repo contains no Firebase                                                                          |
| **7 (optional)**        | password-protected collections (FULLSPEC §9 — the settings-page switch already exists and only needs its write path + the unlock endpoint); collection-cap enforcement, if not already done in Phase 2                                                                                                                                                                                                                | a private collection with a password prompts for and accepts it in the public view                                                                                                                    |

---

## 9. Risks (and their mitigations)

1. **Sharp on Bun** — mixed community reports (works in production; one
   Bun build-failure report). Mitigation: prebuilt Sharp ships musl
   binaries, so `bun:alpine` should load it; **if it fails, swap to
   `@img/sharp-wasm32`** (pure WASM, guaranteed to run on Bun, at a CPU
   cost) — acceptable because encoding is off the interactive path.
2. **Better Auth drizzle adapter gotchas** — custom/extra columns must
   exist in the passed schema object, or sign-up fails opaquely (a known
   issue). Mitigation: define every column (core + `profile`) in the
   drizzle schema _before_ first run; Phase 1's acceptance includes a
   signUp round-trip, so breakage is caught immediately.
3. **Local/prod runtime divergence** — Bun locally, node in prod, is a
   footgun. Mitigation: the same runtime (Bun) in both, per the "use bun"
   instruction (see Open questions, item 1).
4. **The Phase 0 move** — a 40-file `git mv` is a big diff. Mitigation:
   pure renames, verified by the existing 313-test suite going green
   before any rewriting starts.
5. **Presigned PUT + CORS** — a `PUT` with a custom `Content-Type`
   triggers a preflight. Mitigation: the client PUTs **without** a
   `Content-Type` header (the server records `contentType` from the form's
   `File`, as it does today), so no bucket CORS config is needed.

---

## 10. Open questions (decisions needed before implementation)

1. **Prod container runtime:** `bun:alpine` (honors "use bun"; Sharp
   risk with the WASM fallback, as above) **vs** `node:22-slim` in prod
   only (zero native-module risk; local stays Bun). Recommendation:
   `bun:alpine` everywhere.
2. **The unused `VITE_USE_NEW_API` / `VITE_API_URL` env vars:** delete
   (recommended — the service-layer swap _is_ the cutover) or keep as a
   dual-backend toggle during Phase 5?
3. **Beta scope:** include `/signup`, `/manage/profile`, and the
   one-collection cap **in this migration** (recommended — Better Auth
   makes them near-free, and Users data is coming) or defer them?
4. **Prod domain:** is there an ACM certificate for `arcula.art`
   already, and should `deploy` wire a Route 53 alias (or leave DNS to
   the operator)?
