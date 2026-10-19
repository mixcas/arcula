# The collection gates; a work is published or draft

**Status**: accepted

An artwork's visibility used to be its own `isPublic` flag, independent of its
collection's. The two flags together admitted a case — a public work inside a
private collection — that was readable by direct id, was absent from the
visitor's list, and had photo bytes the media proxy refused. The collection is
now the only gate on a visitor: an artwork carries `status`, `published` or
`draft`, and a visitor sees a published work exactly when its collection is
public. A draft is part of the collection, hidden by the gate rather than by a
second flag.

The vocabulary is in [GLOSSARY.md](../GLOSSARY.md): **Published**, **Draft**,
**Public**, **Private**.

## Considered Options

- **Keep the per-work flag.** Rejected. Its only lived effect over the
  collection's flag was "hide this work from the visitor list", which is what
  draft now says in the product's own words. The extra expressiveness it bought
  — a work discoverable by id inside a private collection — had no usage, and
  the cost was a policy spread across four implementations with three different
  answers (`routes/artworks.ts`, `routes/media.ts`, `routes/collections.ts`,
  `authorize.ts`).
- **A draft that is not yet in the collection.** Rejected. It makes publishing
  a membership change rather than a state change, which forks the owner's lists
  and the collection's count, and moves the save path into a second protocol.
- **A three-state `draft` / `published` / `archived`.** Rejected. Nothing in the
  product needs a work that is out of the collection without being deleted;
  soft delete already covers leaving the collection and being brought back.
- **Never drop `isPublic`.** Rejected. A column no code reads is a claim that
  lies to the next reader; the migration is forward-only and the drop is the
  honest shape.

## Consequences

- Removing the case "a published work is readable by id inside a private
  collection" is the policy change. The two tests that pinned it
  (`save.api.test.ts`, `mediaProxy.api.test.ts`) are rewritten to pin its
  replacement: the collection is the whole gate on both the row and the bytes.
- The drop is destructive. Under the forward-only rule in
  [AGENTS.md](../AGENTS.md), a revert of the dropping release leaves old code
  against a schema without the column, so it needs a compensating migration. It
  shipped as two releases — column plus backfill, then the switch and the drop —
  for that reason.
- The list route stays a SQL filter over `status`; the verdict is pure over
  loaded rows. The two declarations meet in one test that asserts the list and
  the single-row verdict agree on the same fixture.
- Documents are unaffected: they are owner-only, at any status, in any
  collection.
