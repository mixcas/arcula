# One AWS account and one CDK bootstrap for both environments

**Status**: accepted

Production and dev both live in the same AWS account and region, on one CDK
bootstrap (`CDKToolkit`). They are told apart by stack name — `Arcula` and
`ArculaDev` — and by nothing else in the account. Separate accounts or a second
bootstrap qualifier would each be a stronger boundary, and both were turned
down: the account's marginal cost stays near zero with two stacks in it, and
the boundary that matters most — one environment's secrets being unreadable
from the other — is bought by GitHub instead. Each GitHub Environment
(`dev`, `production`) admits exactly one branch, and each AWS deploy role is
trusted to exactly one branch, so a workflow running on `dev` cannot read
production's database URL or auth secret, and cannot assume production's
identity by editing a workflow file.

The boundary that is **not** bought: both deploy roles may assume the account's
`cdk-*` bootstrap roles, because that is how a CDK deploy works. A modified
workflow on `dev` could therefore reach production's stack. That is accepted
deliberately rather than mitigated, and it is not to be over-claimed: secrets
cannot cross, stacks could.

## Considered Options

- **A second CDK bootstrap qualifier.** Rejected. It would divide the bootstrap
  roles that give each environment its deploy path, at the cost of a second
  bucket, a second set of roles, and a second `cdk bootstrap` to document and
  re-run — for a boundary that a branch change on a role's trust policy can
  still cross if someone edits it deliberately.
- **A second AWS account.** Rejected. It is the real boundary, and the only one
  that would survive a widened trust policy, but it doubles the provisioning:
  a second account, its OIDC provider, its budget alerts, its certificates and
  its DNS delegation, for an environment whose whole purpose is to be cheap
  enough to keep.

## Consequences

- Both stacks appear in one console and one cost report; their names and
  descriptions are what tell them apart, which is why the stack description
  differs by environment and the dev artifact is named for its environment.
  The names themselves live in one table the shell and the stack both read,
  so nothing restates them.
- Tearing dev down must not be able to touch production. Anything that resets
  dev names dev's stack and dev's database explicitly, and reads dev's bucket
  off dev's own stack rather than searching the account for buckets.
- The weaker boundary has to stay written down, because a reader who assumes
  the two environments are fully isolated would be wrong in the one direction
  that matters least — and right about the one that matters most.
