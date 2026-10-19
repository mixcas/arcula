# Arcula — AWS CDK

One stack class, `ArculaStack`, deploys the whole product as **one Lambda
behind one HTTP API**, with the media in S3. The class is instantiated once
per environment, selected by the required `ENV` context value: `prod` (the
`Arcula` stack) or `dev` (the `ArculaDev` stack). That is the entire footprint
of either environment: no VPC, no ALB, no ECS, no RDS. Postgres lives in
Supabase, created out of band and reached over its public connection string.

Only what must differ by environment does: the stack's name and description,
the API's display name, the Lambda artifact, and — on dev only — two function
environment variables. Construct ids and logical ids never vary, so the dev
stack's existence does not change production's template.

## What the stack creates

- **`Media`** — a private, encrypted S3 bucket (`enforceSSL`, all public access
  blocked). Its `staging/` lifecycle rule expires staged objects after 7 days.
- **`ApiFunction`** — a single `nodejs24.x` / `arm64` Lambda at 3008 MB / 300 s.
  It runs the Hono app **and serves the built SPA** from the same artifact
  (`WEB_DIST=/var/task/web/dist`). The stack reads this environment's artifact
  from `dist/lambda/` (`arcula-api.zip` for production, `arcula-api-dev.zip`
  for dev), built by `scripts/build-lambda.sh` and smoked in a glibc container
  before it ships. `NODE_ENV=production` is what makes Better Auth mark the
  session cookie `Secure`.
- **`Api`** — an API Gateway **HTTP API** with a single greedy `/{proxy+}` `ANY`
  route to the Lambda. `spa.ts` splits `/api/*` from the SPA inside the handler.
- **`ApiDomain` / `ApiMapping`** and **`ApiDomainForwww` / `ApiMappingForwww`** —
  optional, gated on the `DOMAIN` context value. Each name gets its own
  `AWS::ApiGatewayV2::DomainName` + root `ApiMapping` pair, because an HTTP-API
  custom domain serves only its exact host: `www` needs its own pair, or API
  Gateway answers `403` before the Lambda runs. The apex keeps its original
  logical ids so a redeploy is an in-place update rather than a recreate.

## Context values

Nothing secret is committed; the deploy passes `-c KEY=value`:

| Context               | Used for                                                    |
| --------------------- | ----------------------------------------------------------- |
| `ENV`                 | which environment to synthesise: `prod` or `dev` (required) |
| `DATABASE_URL`        | the Supabase Postgres connection string                     |
| `AUTH_SECRET`         | the Better Auth signing secret                              |
| `RESEND_API_KEY`      | transactional mail                                          |
| `PUBLIC_URL`          | the one public origin (API + SPA + mail links)              |
| `DOMAIN` / `CERT_ARN` | the optional custom domain and its us-east-1 ACM cert       |
| `DEPLOYED_COMMIT`     | dev only: the commit `/api/health` reports                  |

`ENV` is required: an absent or unknown value fails synthesis rather than
defaulting, so a stack is never built without knowing which environment it is.
The two dev-only function variables — `DEPLOYED_COMMIT` and `NOINDEX` — are
wired only when `ENV=dev`; production's function environment never carries
them.

At synth, absent secrets fall back to placeholders, so `cdk synth` stays green
with no AWS account and no secrets. `scripts/deploy-prod.sh` enforces their
presence before it deploys.

## `PUBLIC_URL` is two-step

The HTTP API's URL only exists after the first deploy, so the deploy script
deploys once, reads the `ExecuteApiUrl` output, and re-deploys with the real
`PUBLIC_URL`. The Lambda is stateless, so the re-deploy costs nothing; the custom
domain then makes the URL stable.

## Outputs

`ExecuteApiUrl`, `MediaBucket`, and `ApiFunctionName` (whose environment the
deploy script reads back to run the seed), plus — when `DOMAIN` is set —
`ApiRegionalDomainName`, `ApiRegionalHostedZone`, and
`ApiRegionalDomainNameForwww`: the exact targets the DNS records point at. Every
`DomainName` gets its own regional endpoint, so the `www` target is **not** the
apex's.

## Commands

`bun run build` (emit `src/` to `dist/` via `tsconfig.build.json`) and
`bun run synth` drive the CDK app, which does its own `bun install`: it is
deliberately **not** a workspace member and never imports application code.
`bun run test` runs the stack's vitest suite, which asserts the environment
conditionals — the stack identity, the dev-only function variables, the
artifact and the API display name — and nothing about the stack's
unconditional resources. The repository's `bun run check` typechecks this
package (`tsconfig.json`, both `src/` and `tests/`). Deploys go through
`sh scripts/deploy-prod.sh`, never a bare `cdk deploy`.
