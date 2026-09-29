---
description: Write a commit message for the uncommitted changes
---

Write a commit message for the current uncommitted work.

Do not run `git commit`, `git add`, `git stash`, `git reset`, or anything else
that changes repository state. This command only produces the message text; the
user commits it themselves. The message must be directly pasteable.

Read the `git-commit` skill for the Conventional Commits type list and the Git
safety protocol, and stop before its "Execute Commit" step.

## Working tree state

!`git status --short`

!`git diff --cached --stat HEAD`

!`git diff --cached --no-color`

!`git diff --stat`

!`git diff --no-color`

!`git ls-files --others --exclude-standard`

!`git log --no-color --oneline -15`

## Steps

1. If there is nothing to commit, say so in one sentence and stop.
2. Read the diffs. If they were truncated, run `git diff HEAD` yourself and
   read any untracked file that matters. Never stage anything.
3. Flag any file that looks like a secret (`.env`, credentials, keys, tokens) and
   exclude it from the message's description.
4. Pick the type and scope from what the diff actually does, then write the
   message.

## Message style

- Subject: `<type>(<scope>): <description>` — imperative mood, lowercase after
  the colon, no trailing period, under 72 characters. Omit the scope when no
  single area dominates.
- Body: only when the subject cannot carry the change — several unrelated
  concerns, a non-obvious reason, a schema/migration or deploy consequence, or
  something a future reader would otherwise get wrong. Wrap at 72 columns. Do
  not restate the diff line by line.
- Never invent issue numbers, co-authors, trailers, or `BREAKING CHANGE`
  footers. Include a footer only if the diff actually supports one.
- Match the recent subjects above: terse and factual.

## Output

Print one fenced code block labelled `text` containing only the finished
message, ready to paste. No preamble, no commentary, no second block, no
suggested variations.
