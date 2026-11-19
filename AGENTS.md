# Arcula Agent Guide

> The design record lives in **`DESIGN.md`** — the as-built description
> of the product, its data model and its architecture. This file is the working
> guide: layout, commands, the sharing rules, and the test criterion, whose
> doctrine is **`docs/testing.md`**. `README.md` is the user-facing overview.
>
> The product is **Arcula** (`arcula.art`), and the packages, the repository
> and the identifiers all say `arcula` too. The product's own vocabulary is in
> **`GLOSSARY.md`**; decisions with their rejected alternatives are in
> **`docs/adr/`**, and implementation-ready feature specs are in
> **`docs/specs/`**.

Arcula is a **Bun workspaces monorepo**. One product, a few packages, and two
environments of one deploy shape:

- **`apps/web`** — the React 19 + Vite SPA (Mantine v9), including the public
  catalogue pages (the "skins"), the Connection consent screen and the account's
  agent-access card.
- **`apps/api`** — the Hono API, run by Bun in dev and by a Node 24 Lambda in
  prod. It also serves the built SPA and hosts the MCP endpoint.
- **`packages/shared`** — the client⇄server contract: types, Zod schemas, the
  file caps, the photo-ordering helpers and the structured artwork search.
- **`packages/db`** — the Drizzle schema and the generated migrations, including
  the agent-access OAuth tables and the write limiter's counter.
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

Hand edits to a generated migration are deliberately few, and there are exactly
three: a data backfill, the add-nullable → backfill → set-not-null sequence, and
a grant revoke drizzle-kit cannot model; `packages/db/README.md` lists them, and
`0006_enable_rls` carries the third's first instance while
`0012_account_write_windows` and `0013_agent_access` repeat it for the tables
that followed.

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

| Command                                                     | What it does                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `bun run dev`                                               | Bring up the local stack, then the API (`:8000`) and web (`:3000`)                                          |
| `bun run stack:up` / `stack:down`                           | The local stack alone                                                                                       |
| `bun run check`                                             | Typecheck every package and `scripts`, ESLint, Prettier, `check:docs` and `knip` — **the gate before a PR** |
| `bun run test`                                              | All suites in parallel: `test:shared`, `test:db`, `test:api`, `test:web`, `test:cdk`, `test:scripts`        |
| `bun run build`                                             | Build the web app                                                                                           |
| `bun run db:migrate` / `db:reset` / `db:seed` / `db:studio` | Drizzle against the local DB                                                                                |

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
`scripts/stack-up.sh` is idempotent, and the stack is one per machine: a git
worktree borrows the main checkout's `.env` and compose project, so the suites
run there against the same services (the mechanics are in `docs/testing.md`).

### Source maps

**Every build carries source maps except a production deploy**, and the
exception is enforced rather than trusted. `vite build` emits linked maps — a
`.map` beside the bundle, named by a `sourceMappingURL` reference — unless
`ARCULA_SOURCE_MAPS=off`; the variable is deliberately not `VITE_`-prefixed,
because Vite inlines those into the client bundle and this is a build
instruction, not client configuration. `sh scripts/build-lambda.sh <env>`
derives it from the environment argument it already validates: dev builds the
Lambda bundle with an external map, appends the reference Bun omits, and the
stack gives the dev function `NODE_OPTIONS=--enable-source-maps`; production
builds neither.

Before anything is zipped, the build gates the staged tree in both directions —
production must hold no map file and no reference in the bundle or the served
SPA, dev must hold the bundle's map and reference and the SPA's maps — and
`apps/api/scripts/deploy-verify.ts` re-proves the property against the deployed
host. Production's map-free artifact is therefore **deliberate: do not "fix"
it**, and dev's source exposure is accepted: `dev.arcula.art` is public and
noindexed, and serving its maps is the price of debugging it as a browser sees
it. `arcula.art` publishes nothing about its source.

## Where things live

Five packages, one product: the SPA (`apps/web`), the API (`apps/api`), the
contract both sides read (`packages/shared`), the schema and its generated
migrations (`packages/db`), and the stack (`infra/cdk`), with the local stack,
the Lambda build and both deploys in `scripts`.

The module-by-module map — what each file in the API, the shared contract, the
web app and the database owns — is in
[`docs/architecture.md`](docs/architecture.md). Read it before changing a
module you have not touched; a named file or symbol is still read directly.

The agent surface is `apps/api/src/mcp/` — `guard.ts` (the verified JWT and the
consent-row check), `server.ts` (the per-request transport), `dispatcher.ts`
(the tool seam, with no MCP type in its signature), `tool.ts`, `registry.ts`
and `tools/` (`catalogues`, `artworks`, `import`). Its user-id-taking cores are
`catalogueWrite.ts`, `artworkWrite.ts` and `artworkImport.ts`; the reads are
`catalogueList.ts`, `catalogueCounts.ts` and `artworkRead.ts`; `agentLimiter.ts`
is the write limiter. The account surface is `routes/connections.ts` with
`connectionList.ts` and `consentQuery.ts`, and the web side is
`components/auth/ConsentPage.tsx`, `auth/oauthResume.ts` and
`components/manage/AgentAccessCard.tsx`. The database adds
`account_write_windows` (`0012_account_write_windows`) and the eight OAuth/JWKS
tables (`0013_agent_access`); the shared contract adds the structured query in
`packages/shared/src/artworkSearch.ts` and
`packages/shared/src/schemas/connection.ts`.

The request path is `browser → API Gateway → Lambda (Hono) → Postgres / S3`; an
agent takes the same path to the same Lambda at `/api/mcp`. In production the
SPA is that same Lambda, and media is proxied through the API so one
authorization layer covers both the row and the bytes (`DESIGN.md` →
**Architecture at a glance**, and **Media**).

## Sharing and protected catalogues

Both are built. Access is membership, and membership is the write verdict:
every account with a `catalogueCollaborators` row reads and writes everything
inside the catalogue — drafts and documents included — exactly as the owner;
only access administration (invite, resend, revoke, remove, transfer) is
owner-only, and the owner cannot leave without transferring.

A password is a **second condition a public catalogue can require, never a third
visibility state**: membership skips the challenge, an Access grant admits
exactly the visitor surface — published, live works, never a draft or a
document — and a grant does not open a private catalogue.

The as-built detail — the invitation lifecycle and its two mails, ownership
transfer without moving media, the grant cookie, the throttle's numbers — is in
**`DESIGN.md` → "Access control"**; the reasoning and its rejected alternatives
are in
[ADR-0004](docs/adr/0004-collections-are-shared-by-membership.md) and
[ADR-0005](docs/adr/0005-a-password-is-a-second-condition-on-a-public-collection.md).

## Agent access

Arcula hosts an MCP server at `POST /api/mcp` on the same Lambda and origin as
the app. A person adds that URL in their client's connector settings, signs in
and approves a **Connection** once; the account profile lists every Connection
with when it connected and last acted, and Revoke ends one without touching the
browser session. Nine tools speak Catalogue, Artwork and Kind: list, read,
create and update Catalogues; search, read, create and update Artworks; and
import a batch of works as Drafts by default. Writes are metered per account;
reads are not.

The as-built detail — the endpoint, the Connection model and its one-install
limitation, the tool surface, the search contract, the import status rule and
the limiter's numbers — is in **`DESIGN.md` → "Agent access (MCP)"**. Client
setup, including OpenCode's 2026-07-28 protocol pin, is in
[`docs/connecting-a-client.md`](docs/connecting-a-client.md). The
implementation contract is
[`docs/specs/agent-access.md`](docs/specs/agent-access.md), and the decision
with its rejected alternatives is
[ADR-0014](docs/adr/0014-agents-reach-arcula-through-a-hosted-mcp-server.md).

A session token is a cookie in a deployment, never an API bearer: production
mounts no `bearer()` plugin, and the deploy verifier asserts a deploy refuses
the token as an `Authorization` bearer. Local development and the suites keep
the bearer form for their own sign-in helpers.

## Writing the interface

Every word a person reads follows **[`docs/ux-writing.md`](docs/ux-writing.md)**
— the voice (Precise, Dry, Warm), the surfaces where its humour is allowed to
land, the no-fly list, and the mechanics. Read it before writing a string for
the first time; a reviewer applies it to a diff the way they apply
[`docs/testing.md`](docs/testing.md) to a test.

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

**Mutation testing is the acceptance bar for anything new.** Change the line the
test claims to cover; if it stays green, the test was not covering that.

The tiers, the catalogue of tests that do not earn their place, what the gate
catches and what it does not, and the mechanics a test file has to get right are
in [docs/testing.md](docs/testing.md). Read it before writing a test, and when
reviewing a diff.

## Gotchas

- Mantine guidelines are saved in **`.opencode/docs/mantine-llms.txt`** —
  reference it when building UI components or form controls.
- `lodash` is a dependency of `apps/web` and `@types/lodash` is installed.
  Prefer subpath imports (`import debounce from "lodash/debounce"`) for smaller
  bundles.
- Config comes from the repo-root `.env`; `VITE_*` vars are web-only and are
  inlined at build time. A worktree made by `scripts/worktree-new.sh` gets its
  own gitignored `.env` with a per-branch port; otherwise the repo-root file is
  the local fallback. A deploy reads `infra/cdk/.env.<env>` instead (the
  untracked `.env` there is production's fallback, and dev deliberately has none
  — falling back would put production's database URL into a dev deploy). Never
  commit real secrets; see
  **Two rules that are load-bearing** above.

## Validation

- `bun run check` — `tsc` over every package and `scripts`, ESLint, Prettier,
  `check:docs` (a pointer into the navigation docs that resolves to nothing
  fails the gate) and `knip` — must pass before and after any change, and before
  a PR. The `infra/cdk` package is deliberately
  not a workspace member and installs its own dependencies, so run
  `cd infra/cdk && bun install` once before the check can resolve
  `aws-cdk-lib` — in a fresh worktree, `sh scripts/worktree-new.sh <branch>`
  creates it and runs both installs for you.
- `bun run test` runs every suite; the API and web suites need the local stack —
  the commands they run are under **Test mechanics** in
  [docs/testing.md](docs/testing.md). `npx vitest run <file>` inside a package
  runs a single file.
- **Deploy**: `sh scripts/deploy-prod.sh` (production) or
  `sh scripts/deploy-dev.sh` (dev). Both end by running
  `cd apps/api && bun scripts/deploy-verify.ts <url>` — the end-to-end pass
  against the deployed URL; the script's header lists its current steps,
  including the source-map rule, so this guide does not repeat them. The
  catalogue cap is covered by the API integration suite instead, since
  reaching it would mean ten creates per run. It takes the URL, not an
  environment, so it runs against either one by hand. It creates a throwaway
  `verify-<ts>@example.test` account per run, so treat it as a write against
  the environment. A deploy whose host does not resolve yet prints the DNS
  records and exits successfully instead of verifying — that is the first dev
  deploy's shape, not a failure.
- Custom-domain changes: the apex and `www` are distinct `DomainName` resources
  with distinct regional endpoints; the stack emits both
  (`ApiRegionalDomainName`, `ApiRegionalDomainNameForwww`) and
  `scripts/deploy.sh` prints each against the matching Porkbun record.
  Those DNS records are console-only (no API access), and the apex and `www`
  targets are **different** `d-…` values — do not point one at the other.

## Agent skills

### GitHub CLI

**Before every `gh` call, confirm the active account is `mixcas` and no other.**
This machine is logged in to more than one GitHub account, and an inactive one
being active would act as the wrong person against a public repository. Check
with `gh auth status` and read the `Active account: true` line; if it is not
`mixcas`, switch with `gh auth switch --user mixcas` before running the command.
Never pass `--hostname` or a token env var to sidestep the check, and do not run
a `gh` command whose side effects land on the wrong account.

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
environments sharing one AWS account and CDK bootstrap, the catalogue as the
only visitor gate, and catalogues shared by membership. See
`docs/agents/domain.md`.

## graphify

This project keeps a **local** knowledge graph at `graphify-out/`, built by the
installed plugin: god nodes, community structure, and cross-file relationships.
It is gitignored and never committed, so no branch or pull request carries it
and a rebuild is never part of a diff.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:

- When graphify-out/graph.json exists, a question that spans a subsystem no prompt or report has named a file for starts with `graphify query "<question>"`; a named file or symbol is read directly. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts — these return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the local graph current (AST-only, no API cost). The rebuild writes only ignored files; there is nothing to stage.

# External docs — fetch on demand

Use web fetch / browser / search tools to load these when implementing or
debugging third-party behavior. Do not paste full upstream docs into the chat.

## Index URLs (read these first)

| Area    | llms.txt                     |
| ------- | ---------------------------- |
| Mantine | https://mantine.dev/llms.txt |
| Hono    | https://hono.dev/llms.txt    |

## Read order

1. Fetch the **llms.txt** for the dependency that owns the question.
2. Follow **only** links from that file (or obvious `/docs/*.md` siblings) for
   depth.
3. Prefer Markdown sources over scraping marketing HTML.
4. If types exist locally (`node_modules`, stubs), use them **after** you know
   which API surface applies (avoids guessing wrong symbols).

## Scope

- Questions about **our** repo layout → /graphify codebase search, not llms.txt.
- Questions about **their** API/version/docs → use the table above.
