# Arcula Agent Guide

> The design record lives in **`project-plan.md`** — the as-built description
> of the product, its data model and its architecture. This file is the working
> guide: layout, commands, and the test doctrine. `README.md` is the
> user-facing overview.
>
> The product is **Arcula** (`arcula.art`), and the packages, the repository
> and the identifiers all say `arcula` too. The product's own vocabulary is in
> **`GLOSSARY.md`**; decisions with their rejected alternatives are in
> **`docs/adr/`**.
>
> **Sharing is partly built.** Access as membership — the shared dashboard
> list, documents for members, every write path a collaborator needs, the
> invitation loop (create, preview, accept, decline), the owner's access read
> and offer administration (resend, revoke), removal and leaving, the invitee's
> in-app list and decline, and the settings page's access card — has landed.
> Ownership transfer is still the target. The model is accepted in
> [ADR-0004](docs/adr/0004-collections-are-shared-by-membership.md); the entries
> below that describe the rest of access administration are the target until it
> lands.

Arcula is a **Bun workspaces monorepo**. One product, a few packages, and two
environments of one deploy shape:

- **`apps/web`** — the React 19 + Vite SPA (Mantine v9), including the public
  collection pages (the "skins").
- **`apps/api`** — the Hono API, run by Bun in dev and by a Node 24 Lambda in
  prod. It also serves the built SPA.
- **`packages/shared`** — the client⇄server contract: types, Zod schemas, the
  file caps, the photo-ordering helpers.
- **`packages/db`** — the Drizzle schema and the generated migration.
- **`infra/cdk`** — the CDK stack: one Lambda (API + SPA), an S3 media bucket,
  an HTTP API, and the optional custom domain. One class, instantiated once per
  environment.
- **`scripts`** — the local stack, the Lambda build, and both deploys.

The API and the SPA deploy as **one Lambda behind one HTTP API**, so the app is
same-origin in production and there is no CORS to configure.

## Branches and environments

Two long-lived branches, each feeding one permanent environment. The reasoning
is [ADR-0001](docs/adr/0001-two-branches-two-environments.md); this is the
working rule.

| Branch | Environment               | Deploys on |
| ------ | ------------------------- | ---------- |
| `dev`  | dev — `dev.arcula.art`    | every push |
| `main` | production — `arcula.art` | every push |

- **`dev` is the default branch** and the integration branch. **Cut every
  feature branch from `dev`**, and open the PR against `dev`.
- **Feature PRs are squash-merged into `dev`** — one commit per change, so its
  log stays readable.
- **A release is a PR from `dev` into `main`, merged as a merge commit, never
  squashed.** Squashing it would lose the release boundary and make the next
  release PR replay shipped work as ghosts.
- **A hotfix branches from `main`** and is back-merged into `dev`.
- `main` is production only: its log is the list of what has shipped.
- Both branches are protected: a PR is required, the `check` status is
  required, force pushes and deletion are blocked. Required approvals are off
  (a solo maintainer cannot approve their own PR), and administrator bypass
  stays possible. Squash and merge-commit are enabled, rebase is not, and
  merged branches are deleted.
- **Merging is deploying.** `check.yml` runs the gate on PRs into either
  branch; `deploy-dev.yml` and `deploy-prod.yml` run the gate again on push,
  then build and deploy through `scripts/deploy.sh` — the same script a laptop
  runs. Both can be `workflow_dispatch`ed to re-run a deploy without a new
  commit. Dev cancels a superseded run; production never cancels, so two
  migrations cannot interleave against the production database.
- Dev is public and noindexed, disposable, and has its own database, bucket,
  certificate, `AUTH_SECRET` and Resend key. Its `/api/health` reports the
  deployed commit; production's does not.
- The limits of the isolation are real and recorded: the two environments
  share one AWS account and one CDK bootstrap, so a modified `dev` workflow
  could reach production's stack — but cannot read production's secrets. See
  [ADR-0002](docs/adr/0002-one-account-one-bootstrap.md).

### Two rules that are load-bearing

The repository is public, so both of these are not style preferences:

- **Never commit a secret.** Not in a file, not in a test, not in a workflow,
  not in a logged command. Per-environment values live in `infra/cdk/.env.<env>`
  (gitignored) and in the GitHub Environments; `SEED_*`, `DATABASE_URL`,
  `AUTH_SECRET`, `RESEND_API_KEY` and `CERT_ARN` are secrets or variables
  there, never in the tree.
- **Never use the fork-exposing pull-request event.** A workflow that needs to
  run on a PR uses the plain `pull_request` event, never
  `pull_request_target`: the latter runs with the repository's secrets and
  hands them to a fork's code. `check.yml` is the model — it reads the PR's
  code and needs no secret at all.

### Migrations are forward-only

`packages/db/migrations/` is generated and applied, never reversed. A deploy
runs them forward — dev's on dev's deploy, production's on its own — and
nothing un-migrates a database. So **reverting a commit redeploys the code but
leaves the schema where it was**: a revert is safe only when the release's
change was additive (a new nullable column, a new table, a new index). A revert
of a destructive migration (a dropped column or table, a tightened constraint)
leaves the old code running against a schema that no longer matches it, and
needs a compensating migration written by hand.

**A schema change ships alone.** `scripts/deploy.sh` deploys the Lambda before
it migrates, so a release carrying both a new table and the code that reads it
would serve requests against a schema that is not there yet. Ship the migration
in its own release, then the code. When the change is additive — a new nullable
column, a new table, a new index — the intermediate release is safe because the
old code ignores it. A column that must end up `NOT NULL` is added nullable in
that release and tightened in the release that writes it; one migration that
sets `NOT NULL` would break the old code's inserts.

## Key commands

All from the repo root (`bun run <script>`):

| Command                                                     | What it does                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `bun run dev`                                               | Bring up the local stack, then the API (`:8000`) and web (`:3000`)                   |
| `bun run stack:up` / `stack:down`                           | The local stack alone                                                                |
| `bun run check`                                             | Typecheck all packages + ESLint + Prettier — **the gate before a PR**                |
| `bun run test`                                              | All suites in parallel: `test:shared`, `test:db`, `test:api`, `test:web`, `test:cdk` |
| `bun run build`                                             | Build the web app                                                                    |
| `bun run db:migrate` / `db:reset` / `db:seed` / `db:studio` | Drizzle against the local DB                                                         |

Deploy is a shell script, not a package script. `sh scripts/deploy-prod.sh` and
`sh scripts/deploy-dev.sh` are thin wrappers over the one sequence in
**`scripts/deploy.sh`** (cdk build → `cdk deploy` → resolve the URL → migrate →
seed → re-deploy with the real `PUBLIC_URL` → `deploy-verify`). CI calls the
same two scripts, so the sequence has one definition.
`sh scripts/build-lambda.sh <prod|dev>` builds that environment's zip first;
`scripts/lambda-smoke.mjs` smokes it in a glibc container before it ships —
except on a CI runner, which sets `SKIP_LAMBDA_SMOKE=1` (it has no local
stand-ins), where the deploy's own end-to-end pass on the deployed Lambda is
the equivalent proof. `scripts/write-env-file.sh <env>` writes the
environment's file from a CI run's GitHub Environment values.
`scripts/provision-cert.mjs` and `scripts/provision-oidc.mjs` provision a
host's certificate and the GitHub deploy roles; `scripts/reset-dev.sh --yes`
drops the dev schema and empties the dev bucket; `scripts/setup-dev.sh` walks
dev's first run interactively. The first-run order, in the order it must be
performed, is in `infra/cdk/README.md`.

The **local stack** is Postgres (a docker/colima container), SeaweedFS (the S3
stand-in, native on `:9000`) and Mailpit (native SMTP on `:1025`, UI `:8025`).
`scripts/stack-up.sh` is idempotent.

## Where things live

**`apps/api/src/`**

- `app.ts` — the Hono app: the error envelope, the `www`→configured-origin
  redirect, CORS, route mounting. `main.ts` runs it under Bun; `lambda.ts` is
  the Lambda handler. `env.ts` reads the configuration once; `responsePolicy.ts`
  holds the pure decisions derived from it.
- `access.ts` — the access verdicts, pure over loaded rows: the membership
  fact (owner, collaborator, nobody) and the visitor rule (the collection is
  the only gate); `authorize.ts` loads the collection, the viewer's membership
  row and the row each route acts on, and answers the one write question —
  `requireMemberCollection` / `requireMemberArtwork`, owner or collaborator —
  that every write path asks.
- `artworkRead.ts` — the single read path for Artworks: one work (the
  Collection, the work, its photos, documents and Variants) or a Collection's
  list (the Collection, the works once, each child table once for the whole
  page — at most five queries, six for a collaborator's membership row),
  returning ok, not-found, or forbidden for the list. The verdict is
  `access.ts`'s over rows the module loads through `authorize.ts`; the module
  carries no Hono type and the route owns the wire code. The save routes read
  their work back through it.
- `spa.ts` — splits `/api/*` from the SPA and serves `WEB_DIST`.
- `auth.ts` — the Better Auth instance (Drizzle adapter). `session.ts` resolves
  the caller.
- `invitations.ts` — the pure token algebra (`mintInvitationToken`,
  `hashInvitationToken`, `normalizeEmail`) and the two questions the routes ask
  of a row: `isInvitationUsable` (pending and not past `expiresAt`) and
  `isInvitationResendable` (pending, and the last issue older than the
  60-second cooldown — expiry is deliberately not part of it).
- `routes/` — `collections`, `access` (the access read, removal and leaving;
  transfer to come — the only owner-only surface left), `invitations` (create,
  resend, revoke, public preview, accept, decline, the invitee's inbox and
  in-app decline), `artworks`, `me`, `media` (the object proxy), `artworkMedia`
  (stage/process, under the caller's own staging prefix).
- `media/` — `keys.ts` (the object-key algebra), `pipeline.ts` (Sharp),
  `variants.ts` (the geometry), `promote.ts` (staged → final).
- `storage.ts` — the S3 client (`S3_ENDPOINT` is required; it refuses a default).

**`packages/shared/src/`** — the contract: `schemas/` (artwork, artworkImport,
collection, invitation, document, user), `artworkPhotos.ts` (the `order`
invariant, `sortPhotos`/`reindexPhotos`, the `photoUrl` ladder), `caps.ts` (file
caps + accepted types), `limits.ts` (the per-tier collection cap), `slug.ts`,
`types.ts`.

**`apps/web/src/`** — `App.tsx` routes; `services/` are the API clients
(`api.ts` is the transport); `auth/` is the Better Auth React client;
`components/manage` and `components/collection`; `skins/` is the public-view
system.

**`packages/db/src/index.ts`** — the Drizzle tables (`user`, `session`,
`account`, `verification`, `collections`, `collectionCollaborators`,
`collectionInvitations`, `artworks`, `artworkPhotos`, `artworkPhotoVariants`,
`artworkDocuments`) and the `schema` object the adapter consumes. The two
sharing tables are in the schema and `collectionCollaborators` is read on every
access question; the invitation routes write `collectionInvitations`, while the
code that writes `collectionCollaborators` covers acceptance, removal and
leaving — `transfer`, which rewrites the row, does not exist yet.
`packages/db/migrations/` is generated; hand edits are the documented exception:
a data backfill appended to the generated file, and the add-nullable → backfill
→ set-not-null sequence for a column that cannot be added `NOT NULL` on an
existing table (see `packages/db/README.md`).

**`infra/cdk/src/arcula-stack.ts`** — the stack. `contextValue("DOMAIN")` gates
the custom domain; the apex and `www` are **separate** `DomainName` pairs that
each get their own regional endpoint — an HTTP-API custom domain serves only its
exact host, so pointing `www` at the apex target is the `403` the layout is built
to avoid.

## How a request flows

```
browser → API Gateway (custom domain) → Lambda (Hono) → Postgres / S3
```

In production the SPA is part of that same Lambda: a non-`/api` path returns the
built `index.html` (deep links included), and `/api/*` runs the routes. Media
never goes straight from S3 — `GET /api/v1/media?key=…` proxies the object and
re-checks visibility per request, which is what lets one authorization layer
cover both the row and the bytes.

## What to test

The suite is fast, so volume is not the problem. **Altitude** is: every test is
something a reader has to keep true as the libraries underneath it move, and
something to reason about when it goes red. The question to ask before writing
one is therefore not "is this worth covering?" but:

> **Would this fail if Mantine (or Hono, or Drizzle) changed, or only if we
> changed?**

A test that answers _the library_ is asserting the library's behaviour. It costs
a reader and buys nothing — the library tests itself, and when ours goes red we
have learned nothing that was not visible in the diff.

Three tiers, and the first is where nearly everything belongs:

1. **Pure logic over our own data.** Test directly, no DOM and no server:
   `variantSize` / `coverCrop` (`apps/api/src/media/variants.ts`),
   `parseAcquisitionDate` (`packages/shared/src/schemas/artworkImport.ts`),
   `sortPhotos` / `reindexPhotos` (`packages/shared/src/artworkPhotos.ts`),
   `collectionLimitForTier` (`packages/shared/src/limits.ts`),
   `publicCollectionState`
   (`apps/web/src/components/collection/usePublicCollection.ts`),
   `resolveSkinOptions` (`apps/web/src/skins/registry.ts`), and the access
   verdict (`apps/api/src/access.ts`). Ours end to end, and where a real
   regression lives.
2. **Our value going into the library — only when the failure is invisible in
   review or in a screenshot.** `apps/web/tests/skinHost.test.tsx` reads the
   emitted style tags to prove `cssVariablesSelector` is not `:root`, because a
   skin's type scale leaking onto `/manage` appears in no screenshot anyone
   takes. The Basicx chrome tests read computed `pointer-events`, because jsdom
   does no hit testing and the bug was a link that looked live and went nowhere.
3. **Everything else — don't.** Copy that a `Text` renders, props handed to
   Mantine, a mock's call count with no behavioural meaning, a constant asserted
   against its own value.

**Mutation testing is the acceptance bar for anything new.** Change the line the
test claims to cover; if it stays green, the test was not covering that. A test
that fails its own mutation earns its place; one that needs three separate
mutations to kill is usually two tests.

**What the bar removes**, so it stays legible rather than theoretical — each of
these could only fail by editing the thing it read:

- A constant against its own value. `MAX_ARTWORK_PHOTOS` is a product choice
  (`packages/shared/src/caps.ts`); asserting it equals `10` cross-checks nothing.
  A **correctness floor** is the other case and it stays: getting it wrong is a
  _silent_ failure rather than a changed preference.
- A set against itself — looping `Object.keys(ACCEPTED_IMAGE_TYPES)` through
  `isAcceptedImageType`, which is `type in ACCEPTED_IMAGE_TYPES`.
- A duplicate, checked at the stronger one first.
- Copy. Rendering a component and asserting a string we wrote appeared.
- A title claiming more than its assertion.

**What has not moved**, because the rule cuts one way and it is easy to overshoot
it in a tidy-up: the pure-logic half, essentially in full; every tier-2 DOM test;
the API integration suite (it drives the real app against the real local stack —
Postgres, SeaweedFS, Mailpit — so it is the one place the wire, the schema and
the storage path meet); and correct-altitude cases that happen to be near
neighbours of deleted ones.

Test **mechanics** — `afterEach(cleanup)`, the `matches: query === ""` stub,
`ModalsProvider`, the carousel mock — are in **Gotchas** below and are not
restated here.

## Gotchas

- **Component tests need an explicit `afterEach(cleanup)`.** Test files run per
  file with a `// @vitest-environment jsdom` docblock, and the vitest configs
  deliberately do **not** set `globals`, so Testing Library's automatic cleanup
  never registers. Without it, each render stays in the document and the next
  test's queries match the previous test's rows and dialogs. DOM matchers come
  from `import "@testing-library/jest-dom/vitest"`.
- In jsdom, a `matchMedia` stub that answers `matches: false` for everything
  makes every `mantine-datatable` column vanish, leaving only the selection
  column. The datatable resolves a column's `visibleMediaQuery` through
  Mantine's `useMediaQuery`, which for a column without one calls
  `window.matchMedia("")` in an effect and overwrites its optimistic `true` with
  the stub's answer; Chrome answers an empty query with `true`. Stub
  `matches: query === ""`.
- `useModals()` throws without `ModalsProvider`, so any component under test
  that (transitively) renders a `modals.openConfirmModal` call needs
  `MantineProvider` + `ModalsProvider` + `MemoryRouter` wrapped around it.
- `@mantine/modals` ships **no** stylesheet in v9 — Modal and Overlay styles
  come from `@mantine/core/styles.css`. `@mantine/notifications` does ship one,
  and `<Notifications />` must be mounted (it is, in `apps/web/src/main.tsx`) for
  `notifications.show` to render.
- **A skin must not use a portaled Mantine component.** `Modal`, `Drawer`,
  `Menu`, `Popover`, `Select`, `Combobox` and `Tooltip` all render into
  `document.body`, outside the skin's scope, and would silently pick up the app
  theme. A skin's test suite also needs a mock for `@mantine/carousel` — embla
  measures real rects, so a real `Carousel` initialises against nothing in
  jsdom. `apps/web/tests/helpers/carouselMock.tsx` is that mock, loaded through
  an `async` `vi.mock` factory because `vi.mock` is hoisted above the imports.
- **`bun run test:api` needs the local stack** — it sources the root `.env` and
  runs `stack-up.sh postgres s3 mailpit` first. **`bun run test:web` needs the
  stack _and_ a running API** (`scripts/ensure-api.sh` starts one).
- **SeaweedFS binds a LAN IP at start.** If the machine's address changes (a
  laptop that moved networks) its own internal replication dials a host that no
  longer exists, and storage tests 500 or time out with nothing pointing at the
  cause. Restart it: `pkill -f "weed server"` then `sh scripts/stack-up.sh s3`.
- Mantine guidelines are saved in **`.opencode/docs/mantine-llms.txt`** —
  reference it when building UI components or form controls.
- `lodash` is a dependency of `apps/web` and `@types/lodash` is installed.
  Prefer subpath imports (`import debounce from "lodash/debounce"`) for smaller
  bundles.
- Config comes from the repo-root `.env`; `VITE_*` vars are web-only and are
  inlined at build time. The repo-root file is the local fallback: a deploy
  reads `infra/cdk/.env.<env>` instead (`infra/cdk/.env` is production's
  fallback, and dev deliberately has none — falling back would put
  production's database URL into a dev deploy). Never commit real secrets; see
  **Two rules that are load-bearing** above.

## Validation

- `bun run check` (tsc over every package + ESLint + Prettier) must pass before
  and after any change, and before a PR. The `infra/cdk` package is deliberately
  not a workspace member and installs its own dependencies, so run
  `cd infra/cdk && bun install` once before the check can resolve
  `aws-cdk-lib`.
- `bun run test` runs every suite; the API and web suites need the local stack
  (see Gotchas). `npx vitest run <file>` inside a package runs a single file.
- Before writing a test, read **What to test** above. A green suite is not the
  goal; a test that fails only when we change something is.
- **Deploy**: `sh scripts/deploy-prod.sh` (production) or
  `sh scripts/deploy-dev.sh` (dev). Both end by running
  `cd apps/api && bun scripts/deploy-verify.ts <url>` — the 17-step end-to-end
  pass (health, SPA, sign-up, the `Secure` session cookie, the tier cap, a real
  12 MP photo through stage → process → save, a visitor read, and the
  reset-mail path). It takes the URL, not an environment, so it runs against
  either one by hand. It creates a throwaway `verify-<ts>@example.test` account
  per run, so treat it as a write against the environment. A deploy whose host
  does not resolve yet prints the DNS records and exits successfully instead of
  verifying — that is the first dev deploy's shape, not a failure.
- Custom-domain changes: the apex and `www` are distinct `DomainName` resources
  with distinct regional endpoints; the stack emits both
  (`ApiRegionalDomainName`, `ApiRegionalDomainNameForwww`) and
  `scripts/deploy.sh` prints each against the matching Porkbun record.
  Those DNS records are console-only (no API access), and the apex and `www`
  targets are **different** `d-…` values — do not point one at the other.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`mixcas/arcula`), driven by the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

The five default triage roles, unchanged: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. Both exist
now. The glossary holds the product's own vocabulary — the nouns in the data
model and the design record — and **not** deployment, branch or process
vocabulary, which belongs in this file. ADRs hold decisions with their rejected
alternatives: two long-lived branches feeding two permanent environments, both
environments sharing one AWS account and CDK bootstrap, the collection as the
only visitor gate, and collections shared by membership. See
`docs/agents/domain.md`.
