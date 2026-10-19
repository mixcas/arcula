# Arcula — AWS CDK

One stack, `ArculaStack`, deploying the whole product as **one Lambda behind one
HTTP API**, with the media in S3. That is the entire production footprint: no
VPC, no ALB, no ECS, no RDS. Postgres lives in Supabase, created out of band and
reached over its public connection string.

## What the stack creates

- **`Media`** — a private, encrypted S3 bucket (`enforceSSL`, all public access
  blocked). Its `staging/` lifecycle rule expires staged objects after 7 days.
- **`ApiFunction`** — a single `nodejs24.x` / `arm64` Lambda at 3008 MB / 300 s.
  It runs the Hono app **and serves the built SPA** from the same artifact
  (`WEB_DIST=/var/task/web/dist`). The package is built by
  `scripts/build-lambda.sh` and smoked in a glibc container before it ships.
  `NODE_ENV=production` is what makes Better Auth mark the session cookie
  `Secure`.
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

| Context               | Used for                                              |
| --------------------- | ----------------------------------------------------- |
| `DATABASE_URL`        | the Supabase Postgres connection string               |
| `AUTH_SECRET`         | the Better Auth signing secret                        |
| `RESEND_API_KEY`      | transactional mail                                    |
| `PUBLIC_URL`          | the one public origin (API + SPA + mail links)        |
| `DOMAIN` / `CERT_ARN` | the optional custom domain and its us-east-1 ACM cert |

At synth, absent context falls back to placeholders, so `cdk synth` stays green
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

`bun run build` / `synth` / `deploy` drive the CDK app, which does its own
`bun install`: it is deliberately **not** a workspace member and never imports
application code. Production deploys go through `sh scripts/deploy-prod.sh`, not
a bare `cdk deploy`.
