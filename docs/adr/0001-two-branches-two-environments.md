# Two long-lived branches, two permanent environments

**Status**: accepted

Arcula runs two permanent environments: production at `arcula.art` and dev at
`dev.arcula.art`. Each is fed by exactly one long-lived branch — `main` deploys
production, `dev` deploys dev — and `dev` is the repository's default branch.
Feature branches are cut from `dev` and squash-merged back into it, so its
history is one commit per change. A release is a pull request from `dev` into
`main`, merged with a merge commit and never squashed. Hotfixes branch from
`main` and are back-merged into `dev`. Merging is deploying: nothing ships
without a branch having moved.

The point is that a change is exercised against a real deploy, with its own
database and its own accounts, before a collector can see it. A single branch
would send every commit straight at the live product, and the first person to
find a broken upload would be a collector.

## Considered Options

- **A preview environment per pull request.** Rejected. Each one would need its
  own database, bucket, certificate and secrets, which is real cost and a real
  surface at a volume that does not justify either. Two environments, one of
  which is disposable, cover the same need. The rejected alternative is also
  the reason both environments share one AWS account: see
  [ADR-0002](0002-one-account-one-bootstrap.md).
- **Squash-merging releases into `main` as well.** Rejected. `main` would lose
  the boundary between one release and the next, and each following release
  pull request would replay already-shipped work as ghosts, so its diff would
  stop describing what it actually releases.

## Consequences

- `main` is a list of what has shipped, one merge commit per release; `dev` is
  a list of changes, one squash per feature.
- The two branches cannot share a schema: dev's migrations run on dev's deploy,
  production's on its own, and neither database is ever restored from the
  other.
- Because deploys are merges, rollback is a revert commit on the branch that
  deploys — and the schema does not roll back with it. A revert is safe only
  when the release's migration was additive. See the forward-only rule in
  [AGENTS.md](../AGENTS.md).
- Branch protection, required checks and the two GitHub Environments together
  keep a branch from feeding any environment but its own. The first two gate
  merges; the Environments are what scopes each set of secrets to one branch.
  The isolation that buys, and the isolation it does not, are in
  [ADR-0002](0002-one-account-one-bootstrap.md).
