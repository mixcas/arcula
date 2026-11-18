# Arcula agent guide

Arcula is a catalogue manager for independent collectors, artists and galleries
([DESIGN.md](DESIGN.md) → "What the product is"): a Bun workspaces monorepo in
which **one Lambda serves the SPA, the API and the MCP endpoint on one origin**,
so there is no CORS to configure.

The code is six directories: `apps/web`, `apps/api`, `packages/shared`,
`packages/db`, `infra/cdk` and `scripts`.

## Commands

```bash
bun run dev
bun run check   # the gate before a PR
bun run test
bun run build
```

`infra/cdk` is deliberately not a workspace member: run
`cd infra/cdk && bun install` once after a fresh checkout, before `bun run check`
can resolve `aws-cdk-lib`.

## Working rules

### Branches and environments

- `dev` is the default and integration branch: cut every feature branch from
  it, PR into it, squash-merge. A release is a PR from `dev` into `main`, merged
  as a merge commit, never squashed; a hotfix branches from `main` and is
  back-merged. **Merging is deploying**: CI deploys the environment whose branch
  moved.
- **The check is an obligation.** `bun run check` passes before and after any
  change, and before a PR.
- **Never commit a secret.** Per-environment values live in
  `infra/cdk/.env.<env>` (gitignored) and in the GitHub Environments.
- **Never use `pull_request_target`.** A PR workflow uses plain
  `pull_request`; [`.github/workflows/check.yml`](.github/workflows/check.yml)
  is the model and needs no secret.

### Migrations are forward-only

Nothing un-migrates a database, so a revert leaves the schema: it is safe only
for an additive change — a new nullable column, table or index — and a
destructive migration needs a compensating one. **A schema change ships alone**,
because the Lambda deploys before the migration runs. Detail:
[packages/db/AGENTS.md](packages/db/AGENTS.md),
[packages/db/README.md](packages/db/README.md).

## Tests

Ask of every test: **"Would this fail if Mantine (or Hono, or Drizzle) changed,
or only if we changed?"** A test of the library's behaviour buys nothing; the
library tests itself. **Mutation testing is the acceptance bar for anything
new** — change the line the test claims to cover, and if it stays green the test
was not covering it. The tiers and mechanics are in
[docs/testing.md](docs/testing.md).

## Where to look

| If the task touches…                        | Read                                               |
| ------------------------------------------- | -------------------------------------------------- |
| product, data model, media, access as built | [DESIGN.md](DESIGN.md)                             |
| a module you have not touched               | [docs/architecture.md](docs/architecture.md)       |
| tests                                       | [docs/testing.md](docs/testing.md)                 |
| vocabulary and rejected alternatives        | [GLOSSARY.md](GLOSSARY.md), [docs/adr/](docs/adr/) |
| a contract or feature spec                  | [docs/specs/](docs/specs/)                         |
| branches, CI, deployment                    | [README.md](README.md)                             |
| schema, migrations, the DB                  | [packages/db/AGENTS.md](packages/db/AGENTS.md)     |
| Mantine, skins, the web build               | [apps/web/AGENTS.md](apps/web/AGENTS.md)           |
| MCP, Connections, consent, routes, media    | [apps/api/AGENTS.md](apps/api/AGENTS.md)           |
| CDK, Lambda, the domain and DNS             | [infra/cdk/AGENTS.md](infra/cdk/AGENTS.md)         |

Access is membership, and membership is the write verdict; a password is a
second condition a public catalogue can require, never a third visibility state.
The as-built detail is [DESIGN.md](DESIGN.md) → "Access control"; the reasoning
is [ADR-0004](docs/adr/0004-collections-are-shared-by-membership.md) and
[ADR-0005](docs/adr/0005-a-password-is-a-second-condition-on-a-public-collection.md).

## Tools

- **graphify.** A local knowledge graph lives in `graphify-out/` (gitignored).
  Start a subsystem-spanning question with `graphify query "<question>"` rather
  than grep; read a named file directly. Run `graphify update .` after code
  changes; `/graphify` uses the installed skill.
- **GitHub CLI.** Before every `gh` call, confirm the active account is `mixcas`
  (`gh auth status`, else `gh auth switch --user mixcas`).
- **External docs.** Fetch [Mantine](https://mantine.dev/llms.txt) or
  [Hono](https://hono.dev/llms.txt) first and follow only their links; never
  paste upstream documentation into the chat.
- **Skills.** Load an installed skill with the Skill tool when the task matches
  its description.
- **Vocabulary and decisions** are recorded in [GLOSSARY.md](GLOSSARY.md) and
  [docs/adr/](docs/adr/); issues are in GitHub, via `gh` — see
  [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

Every fact has exactly one home: add it to its owner — the design record, the
architecture map, [README.md](README.md), [docs/testing.md](docs/testing.md), an
ADR, or the package file — not here. This file says when to read them.
