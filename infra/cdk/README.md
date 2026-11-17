# Arcula — AWS CDK

One stack class, `ArculaStack`, deploys the whole product as **one Lambda
behind one HTTP API**, with the media in S3. The class is instantiated once
per environment, selected by the required `ENV` context value: `prod` (the
`Arcula` stack) or `dev` (the `ArculaDev` stack). That is the entire footprint
of either environment: no VPC, no ALB, no ECS, no RDS. Postgres lives in
Supabase, created out of band and reached over its public connection string.
Both environments share one AWS account and one bootstrap; see
[ADR-0002](../../docs/adr/0002-one-account-one-bootstrap.md) for why, and for
the isolation that buys and does not.

Only what must differ by environment does: the stack's name and description,
the API's display name, the Lambda artifact, and — on dev only — three function
environment variables. Construct ids and logical ids never vary, so the dev
stack's existence does not change production's template.

## What the stack creates

- **`Media`** — a private, encrypted S3 bucket (`enforceSSL`, all public access
  blocked). Its `staging/` lifecycle rule expires staged objects after 7 days.
- **`ApiFunction`** — a single `nodejs24.x` / `arm64` Lambda at 3008 MB / 300 s.
  It runs the Hono app **and serves the built SPA** from the same artifact
  (`WEB_DIST=/var/task/web/dist`). The stack reads this environment's artifact
  from `dist/lambda/` (`arcula-api.zip` for production, `arcula-api-dev.zip`
  for dev), built by `sh scripts/build-lambda.sh <env>` and smoked in a glibc
  container before it ships. `NODE_ENV=production` is what makes Better Auth
  mark the session cookie `Secure`.
- **`Api`** — an API Gateway **HTTP API** with a single greedy `/{proxy+}` `ANY`
  route to the Lambda. `spa.ts` splits `/api/*` from the SPA inside the handler.
- **`ApiDomain` / `ApiMapping`** and **`ApiDomainForwww` / `ApiMappingForwww`** —
  optional, gated on the `DOMAIN` context value. Each name gets its own
  `AWS::ApiGatewayV2::DomainName` + root `ApiMapping` pair, because an HTTP-API
  custom domain serves only its exact host: `www` needs its own pair, or API
  Gateway answers `403` before the Lambda runs. The apex keeps its original
  logical ids so a redeploy is an in-place update rather than a recreate.

## Source maps and the dev artifact

Source maps are part of the build, and `scripts/build-lambda.sh <env>` decides
from its environment argument: dev's package carries the Lambda bundle's
external map and the served SPA's maps, production's carries no map file and no
`sourceMappingURL` reference. The absence is deliberate — a map on `arcula.art`
would publish the source — and the build's pre-zip gate refuses either mistake,
so it is a property of the artifact rather than a habit. Dev serving its maps is
accepted: the host is public and noindexed, and this is the price of debugging
it as a browser sees it.

The cost, measured 17 November 2026 on Bun 1.4.4 at the real Lambda entry
(these supersede the earlier estimate of roughly 25 MB → 35 MB):

| Artifact                    | Production   | Dev          |
| --------------------------- | ------------ | ------------ |
| `index.js` (bundle)         | 6,637,886 B  | 6,637,967 B  |
| `index.js.map`              | —            | 12,783,833 B |
| SPA maps (raw)              | —            | 11,163,372 B |
| Package (`arcula-api*.zip`) | 18,132,799 B | 23,545,066 B |

Dev's bundle is production's plus Bun's own `//# debugId` line and the appended
reference, +81 B in total. Its map names 934 sources with their full text
embedded — 87 from this repo (66 under `apps/api`, 21 in `packages/shared` and
`packages/db`) and the rest third-party; its byte count also carries the build
path once per source, so it shifts with the checkout's directory name. The
packaged growth is +5,412,267 B ≈ +5.16 MiB, +29.8%;
inside the zip the maps deflate to 5,429,883 B (the bundle's map 2,710,670 B,
the SPA's two 1,563,981 B and 1,155,232 B). The cost lands on dev's package
alone; production's artifact is unchanged.

## Context values

Nothing secret is committed; the deploy passes `-c KEY=value`:

| Context               | Used for                                                    |
| --------------------- | ----------------------------------------------------------- |
| `ENV`                 | which environment to synthesise: `prod` or `dev` (required) |
| `DATABASE_URL`        | the Supabase Postgres connection string                     |
| `AUTH_SECRET`         | the Better Auth signing secret                              |
| `RESEND_API_KEY`      | transactional mail                                          |
| `EMAIL_FROM`          | the sender; a bare address is normalised to `Arcula <…>`    |
| `EMAIL_REPLY_TO`      | optional monitored inbox; empty sends no Reply-To header    |
| `PUBLIC_URL`          | the one public origin (API + SPA + mail links)              |
| `DOMAIN` / `CERT_ARN` | the optional custom domain and its us-east-1 ACM cert       |
| `DEPLOYED_COMMIT`     | dev only: the commit `/api/health` reports                  |

`ENV` is required: an absent or unknown value fails synthesis rather than
defaulting, so a stack is never built without knowing which environment it is.
Three function environment variables are wired only when `ENV=dev`, and
production's function environment never carries them, on purpose:

- **`DEPLOYED_COMMIT`** — the commit `/api/health` reports, so a deploy answers
  "is my change live?" in one request.
- **`NOINDEX`** — `true` in dev: `/robots.txt` disallows everything and every
  SPA response carries `X-Robots-Tag: noindex`.
- **`NODE_OPTIONS`** — `--enable-source-maps`, so Node resolves the dev bundle's
  external map and a CloudWatch trace names the TypeScript file and line. It is
  set only where a map ships; production's bundle has none to read.

At synth, absent secrets fall back to placeholders, so `cdk synth` stays green
with no AWS account and no secrets. `scripts/deploy.sh` enforces their presence
before it deploys; the values come from `infra/cdk/.env.<env>`
(`infra/cdk/.env` is production's fallback), which is gitignored and never
committed.

## `PUBLIC_URL` is two-step

The HTTP API's URL only exists after the first deploy, so the production deploy
deploys once, reads the `ExecuteApiUrl` output, and re-deploys with the real
`PUBLIC_URL`. The Lambda is stateless, so the re-deploy costs nothing; the
custom domain then makes the URL stable. Dev knows its host up front, so it
skips the read-back entirely and uses its domain as the origin.

## Outputs

`ExecuteApiUrl`, `MediaBucket`, and `ApiFunctionName` (whose environment the
deploy script reads back to run the seed), plus — when `DOMAIN` is set —
`ApiRegionalDomainName`, `ApiRegionalHostedZone`, and
`ApiRegionalDomainNameForwww`: the exact targets the DNS records point at. Every
`DomainName` gets its own regional endpoint, so the `www` target is **not** the
apex's.

## First run

The order is forced: a host's routing target (a `d-…` endpoint) does not
exist until the stack has been deployed once, and both environments share one
account and one bootstrap ([ADR-0002](../../docs/adr/0002-one-account-one-bootstrap.md)).

1. **Bootstrap the account once**, with an identity that has administrator
   access:

   ```sh
   cd infra/cdk && npx cdk bootstrap aws://<account>/us-east-1
   ```

   It is not part of a deploy and no deploy will do it for you: it writes the
   `CDKToolkit` stack and the `cdk-*` roles, going straight at CloudFormation,
   SSM, S3 and ECR, while the deploy identity may only _assume_ those roles
   (`scripts/provision-oidc.mjs`). Running it from a laptop with admin
   credentials once is the whole of it. It is idempotent, and the second
   environment needs nothing from it.

2. **Create the environment's Postgres project** out of band, and fill
   `infra/cdk/.env.<env>` with its `DATABASE_URL`, `AUTH_SECRET`,
   `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `DOMAIN` and the `SEED_*`
   owner account.
   The file is gitignored and never committed.

3. **Provision the certificate**: `node scripts/provision-cert.mjs <host>`.
   Publish the validation record it prints, wait for it to be issued, and put
   the ARN it prints in the file as `CERT_ARN`. The certificate must be in
   `us-east-1`, the one region an HTTP-API custom domain accepts.

4. **Push `dev` and apply the repository settings** — branch protection on
   `dev` and `main`, the `dev` and `production` GitHub Environments each
   restricted to its own branch, and the two deploy roles from
   `scripts/provision-oidc.mjs`. This comes before the first deploy, because
   the deploy a workflow runs is where an environment's values are read.

5. **Deploy once**: `sh scripts/build-lambda.sh <env>`, then
   `sh scripts/deploy-<env>.sh` — or dispatch the deploy workflow, which runs
   the same scripts. While the host does not resolve, the deploy prints the
   routing records it waits on and finishes successfully instead of failing.
   Dev has finished its migrate and seed by then; production stops before
   touching the database.

6. **Publish the routing record** against the stack's own regional endpoint
   (the deploy prints the apex and www targets — they are different `d-…`
   values, so never point one at the other), then run the deploy again: it
   continues, re-deploys with the real `PUBLIC_URL`, and verifies.

The GitHub side stays in step 4: the Environments, their configuration, and the
two deploy roles `scripts/provision-oidc.mjs` creates.

For dev, `sh scripts/setup-dev.sh` walks that sequence interactively and is the
way to do it: it opens each console, captures every value into
`infra/cdk/.env.dev` (gitignored) and the `dev` GitHub Environment, dispatches
the two pipeline deploys the first run needs, and ends on the release. It also
checks each Environment admits only its branch, and sets production's
Environment before the release. The list above is the shape it follows; where
the two disagree, the wizard is right because it is the one that runs. The dev stack is
given a `DOMAIN` like any other, so it derives a www pair too — dev publishes
only the apex, because a `www` host on the dev domain has nothing to alias to.

## Commands

`bun run build` (emit `src/` to `dist/` via `tsconfig.build.json`) and
`bun run synth` drive the CDK app, which does its own `bun install`: it is
deliberately **not** a workspace member and never imports application code.
`bun run test` runs the stack's vitest suite, which asserts the environment
conditionals — the stack identity, the dev-only function variables, the
artifact and the API display name — and nothing about the stack's
unconditional resources. The repository's `bun run check` typechecks this
package (`tsconfig.json`, both `src/` and `tests/`).

Deploys go through `scripts/deploy-prod.sh` or `scripts/deploy-dev.sh` — thin
wrappers over the one sequence in `scripts/deploy.sh` — never a bare
`cdk deploy`. Each environment's package is built by
`sh scripts/build-lambda.sh <env>`, which writes that environment's artifact
(`arcula-api.zip`, `arcula-api-dev.zip`) and smokes it in a glibc container.
`scripts/provision-cert.mjs <host>` provisions a host's certificate, and
`scripts/provision-oidc.mjs` provisions the GitHub OIDC provider and the two
branch-pinned deploy roles; `scripts/reset-dev.sh --yes` drops the dev schema
and empties the dev bucket.
