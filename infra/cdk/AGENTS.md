# infra/cdk — agent notes

Read [the package README](README.md) for the stack's resources, context values
and first-run order, and [the architecture map](../../docs/architecture.md) for
where the stack sits. This file carries only the deltas.

- **Not a workspace member.** Install separately with
  `cd infra/cdk && bun install`: the root workspace's `node_modules` does not
  resolve `aws-cdk-lib`, and `bun run check` typechecks this package with its
  own `tsconfig.json`.
- **One class, instantiated per environment.** `src/arcula-stack.ts` defines
  `ArculaStack`; `src/main.ts` and `src/environments.ts` select `prod` →
  `Arcula` or `dev` → `ArculaDev` from the required `ENV`. Construct and
  logical ids never vary by environment, so a new resource's id must too.
- **Apex and `www` are distinct targets.** Each name has its own `DomainName`
  and root `ApiMapping` (`ApiDomain`/`ApiDomainForwww`), and the deploy prints
  `ApiRegionalDomainName` and `ApiRegionalDomainNameForwww`. An HTTP-API custom
  domain serves only its exact host, so crossing the two `d-…` values is a
  `403` before the Lambda runs.
- **The stack never imports application code.** A fact it needs from the shared
  contract is read by path in its test, as `tests/arcula-stack.test.ts` does for
  the staged-PUT header list; an import would break the separate install.
- **Deploy through the script.** `scripts/deploy-prod.sh` and
  `scripts/deploy-dev.sh` wrap `scripts/deploy.sh` — build the Lambda, deploy,
  resolve `PUBLIC_URL`, migrate, seed, verify — and a bare `cdk deploy` skips
  all but the deploy. `cdk synth` with placeholder secrets proves the template,
  not a deploy.
- **The first-run order is forced** and is the README's "First run": bootstrap,
  the Postgres project, the certificate, the GitHub Environments, the first
  deploy, then the routing record. Do not reorder it.
