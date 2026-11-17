# AGENTS.md

## Tools & commands

- Run `bun run check` after any change and before a PR. It is the gate: `tsc` over every package, ESLint, Prettier, `check:docs` and `knip`.
- In a fresh worktree, run `sh scripts/worktree-new.sh <branch>`. `infra/cdk` installs its own dependencies, and the gate cannot resolve them otherwise.
- Run `bun run test` for every suite, or `npx vitest run <file>` inside a package for one file.
- Deploy only through `sh scripts/deploy-prod.sh` or `sh scripts/deploy-dev.sh`, never a bare `cdk deploy`.
- Use the GitHub CLI for issues in `mixcas/arcula`. Follow [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) and the labels in [docs/agents/triage-labels.md](docs/agents/triage-labels.md).
- Before every `gh` call, confirm `gh auth status` shows `mixcas` as the active account; switch with `gh auth switch --user mixcas` if it does not. Never bypass the check with `--hostname` or a token environment variable.
- For third-party API questions, fetch the owning dependency's `llms.txt` first (Mantine: https://mantine.dev/llms.txt, Hono: https://hono.dev/llms.txt) and follow only its links. Do not paste full upstream docs into the chat.
- For UI components and form controls, consult `.opencode/docs/mantine-llms.txt`.
- For questions about repo layout that do not name a file, query the local graph with `graphify query "<question>"`, `graphify path "<A>" "<B>"` or `graphify explain "<concept>"`. Read a named file or symbol directly. After changing code, run `graphify update .`.
- Import lodash by subpath (`import debounce from "lodash/debounce"`), not the whole package.
- Before writing or reviewing a test, read [docs/testing.md](docs/testing.md).
- Before hand-editing a generated migration, read [packages/db/README.md](packages/db/README.md).

## Workflow requirements

- Cut feature branches from `dev` and open PRs against `dev`. Feature PRs are squash-merged.
- A release is a PR from `dev` into `main`, merged with a merge commit, never squashed.
- Hotfixes branch from `main` and are back-merged into `dev`.
- Merging deploys. Treat a merge to either branch as a deploy of that environment.
- Never commit a secret, in any file, test, workflow or logged command. Per-environment values live in the gitignored `infra/cdk/.env.<env>` and in GitHub Environments.
- Never use `pull_request_target`. A workflow that runs on a PR uses the plain `pull_request` event and needs no secret.
- Migrations are generated and applied forward-only. Never write a down migration or edit an applied one.
- Ship a schema change in its own release, without the code that reads it: the deploy updates the Lambda before it migrates.
- A revert is safe only when the release's migration was additive. Reverting a destructive migration requires a compensating migration written by hand.
- Add a column nullable in one release, then tighten it to `NOT NULL` in the release that writes it.
- Do not add an `infra/cdk/.env` fallback for dev. Its absence is deliberate: the fallback would point a dev deploy at production's database.
- A test must answer: would this fail if Mantine (or Hono, or Drizzle) changed, or only if we changed? Remove a test that only asserts the library.
- Mutation-test anything new: break the line the test claims to cover, watch it go red, then restore the line.
- Record product vocabulary in [GLOSSARY.md](GLOSSARY.md) and decisions with rejected alternatives in [docs/adr/](docs/adr/). Keep deployment and process vocabulary out of the glossary.

## Project-specific context

- A session token is a cookie in a deployment, never an API bearer. Production mounts no `bearer()` plugin, and `deploy-verify` asserts the refusal; local development and the suites keep the bearer form for their sign-in helpers.
- `deploy-verify` creates a `verify-<ts>@example.test` account per run. Treat a deploy as a write against that environment.
- A deploy whose host does not resolve prints the DNS records and exits successfully. That is the first dev deploy's shape, not a failure.
- The apex and `www` are distinct domain resources with different `d-…` targets. Never point one at the other; those DNS records are console-only.
