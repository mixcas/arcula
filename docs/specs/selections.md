# Selections

**Status: implementation-ready.** This is the contract for Selections. It is
precise enough to ticket without further design decisions; the ADR records the
one system-wide decision it makes, and the grilling behind it needs no second
document.

The product vocabulary is [GLOSSARY.md](../../GLOSSARY.md)'s: **Selection**,
**Catalogue**, **Artwork**, **Draft**, **Published**, **Public**, **Private**,
**Protected**, **Visitor**, **Owner**, **Collaborator**, **Skin**, **Slug**,
**Access grant**, **Catalogue PDF**, **Selection PDF** — all of which the ADR
rewrites where a Selection changes what they mean.

The design record:

- Decision: [ADR-0015](../adr/0015-a-selection-is-a-second-gate-over-its-catalogue.md)
  — a Selection is a second gate, not a narrower window, with its audience,
  membership, liveness, ordering, deletion and tier answers.
- Ticket: [#345](https://github.com/mixcas/arcula/issues/345) — the spec as the
  implementer reads it, carrying the test seams.
- Contract: this document. Every decision below is settled; the "Out of Scope"
  section is the list of things deliberately not decided here.

## Problem Statement

A Catalogue has exactly one public page and one way to narrow it: the Catalogue
PDF, which prints the published works in artist-then-title order. A collector or
a gallery regularly needs something else — twelve works shortlisted for a
gallery considering a show, or five works going to an art fair — shown in an
order and to an audience of its own. Today the only options are exporting the
whole Catalogue as a PDF, or handing out a link to the whole Catalogue. Neither
can say "these works, in this order, to these people".

## Solution

A **Selection** is a curated, ordered subset of one Catalogue's works with its
own address and its own audience. It is Public, Private or Protected
independently of its Catalogue: a Private Inventory can have a public Selection,
and a public Catalogue can have a protected Selection. It references works and
never edits them; it shows them as they are now; and it has no members — the
source Catalogue's owner and collaborators curate it, and everybody else who can
read it is a visitor.

The feature has two flows:

- **Curation**, on the Catalogue's manage page: a **Selections** list, a
  Selection's own page with an ordered list, and **Add to selection** beside
  **Delete selected** on the checked works.
- **Reading**, on the Selection's own address: a public page in the Catalogue's
  skin, an artwork detail page under the same address, and a password challenge
  when it is protected.

## User Stories

1. As an Owner or a Collaborator, I want a **Selections** button on the
   Catalogue's manage page beside **PDF**, so that I can find the feature where I
   manage the Catalogue.
2. As an Owner or a Collaborator, I want a list of the Catalogue's Selections
   with each one's name, visibility, work count and last change, so that I can
   tell them apart at a glance.
3. As an Owner or a Collaborator, I want an empty state that explains what a
   Selection is and offers **Create selection**, so that the list is not a blank
   page the first time I open it.
4. As an Owner or a Collaborator, I want to create a Selection from its name and
   an optional description, so that its address and its page say what it is.
5. As an Owner or a Collaborator, I want **Add to selection** on the checked
   works, with a picker of existing Selections and a **New selection** entry, so
   that I can curate from the works I am already looking at.
6. As an Owner or a Collaborator, I want the Selection's page to list its works
   in the order I set, with a drag handle, so that the order is the content.
7. As an Owner or a Collaborator, I want to remove a work from the Selection
   without touching the work itself, so that curation never edits the record.
8. As an Owner or a Collaborator, I want **Add artworks** on the Selection's page to
   pick from the Catalogue's live works, so that I can fill a Selection
   top-down as well as bottom-up.
9. As an Owner or a Collaborator, I want a Draft work to appear in the Selection
   with a **Draft** badge in the manage view, so that I know it is off the
   Catalogue's page while it is on the Selection's.
10. As an Owner or a Collaborator, I want the Selection's page to show how many
    of its works are Drafts before I publish it, so that I publish knowingly.
11. As an Owner or a Collaborator, I want a confirmation that names the Drafts it
    will reveal when I make a Selection public while its Catalogue is Private or
    Protected, so that the one moment this model's risk is taken is explicit.
12. As an Owner or a Collaborator, I want a persistent note on a public Selection
    whose Catalogue is not visitor-readable, so that the state is visible on
    every visit and not only at the moment of publishing.
13. As an Owner or a Collaborator, I want to rename, re-describe, make public or
    private, and set or clear a password, so that a Selection is as manageable as
    a Catalogue.
14. As an Owner or a Collaborator, I want to delete a Selection with a
    confirmation that says the works and their media are untouched, so that the
    act is not confused with deleting art.
15. As an Owner or a Collaborator, I want **View** and **PDF** on the Selection's
    page, so that I can check what a reader sees and export it.
16. As a Visitor, I want the Selection's address to render its name, description,
    works and source Catalogue's name, in the Catalogue's skin, so that it reads
    as part of the same body of work.
17. As a Visitor, I want to open a work from the Selection and read its record
    under the Selection's own address, so that a Draft shown there is readable
    there and nowhere else.
18. As a Visitor to a protected Selection, I want the lock screen and, once
    unlocked, the page itself, so that the password is a second condition rather
    than a second page.
19. As a Visitor, I want a private or deleted Selection to be indistinguishable
    from one that does not exist, so that no address confirms what is hidden.
20. As a Visitor printing a Selection, I want the curator's order and the Drafts
    included, so that the document matches the page I was shown.
21. As a screen-reader user, I want the reorder control to name the work and its
    position, and the remove control to name the work, so that a list of images
    is navigable without sight.

## Implementation Decisions

### Data model

Two tables and their access machinery, in **one additive migration** that ships
alone: `0014_selections` (generated, then the guarded `DO` block revoking `anon`
and `authenticated`, which is the shape `0012` and `0013` established —
[packages/db/README.md](../../packages/db/README.md)).

```
selections
  id            text primary key            -- mintId(), ten base62 characters, no hyphen
  collectionId  text not null               -- the source Catalogue, physical name kept (ADR-0010)
  name          text not null
  description   text
  isPublic      boolean not null default false
  passwordHash  text                        -- scrypt string, as catalogues.passwordHash
  deletedAt     timestamptz                 -- null = live
  createdAt, updatedAt timestamptz

selection_works
  selectionId   text not null
  artworkId     text not null
  position      integer not null            -- 0-based, rewritten to 0..n-1 on every write
  primary key (selectionId, artworkId)
  index on artworkId

selection_access_grants
  selectionId   text not null
  tokenHash     text not null unique
  createdAt, expiresAt timestamptz
  index on selectionId

selection_unlock_attempts
  ip, selectionId, windowStart   primary key
  attempts      integer not null default 0
```

Decisions inside that shape:

- **`isPublic` defaults false.** A new Selection is Private; publishing is a
  deliberate act, and it is the only default that cannot expose works by
  accident.
- **No `skin` or `skinOptions` columns.** The Selection renders in its source
  Catalogue's skin and options (Q14); a per-Selection skin is out of scope.
- **No unique constraint on `position`.** Reordering would need deferrable
  constraints; every write renumbers the whole list (they are small), and reads
  order by `position, artworkId` so the result is deterministic even if a row
  ever carries a duplicate.
- **The grants and the throttle are separate tables**, not a polymorphic subject
  on the Catalogue's. A nullable second subject would need a check that exactly
  one column is set and would rewrite tables whose shape is load-bearing
  (ADR-0015, ADR-0005).
- **No backfill and no tightening.** Every column is either nullable or has a
  default, so the migration is purely additive and the revert rule in
  [AGENTS.md](../../AGENTS.md) applies.

### The verdicts

Pure, in a new `selectionAccess.ts`, beside `access.ts`:

```ts
canSeeSelection(membership, catalogue, selection, hasValidGrant = false) =>
  isMember(membership) ||
  (selection.isPublic && (!hasPassword(selection) || hasValidGrant));
```

The source Catalogue's **visibility never enters the verdict** — that is the
decision (Q2c) — but its **deletion does**, and so does the Selection's:

```ts
selectionRefusal(selection) =>
  selection.isPublic && selection.passwordHash !== null
    ? new ApiError("password-required", "This Selection is protected",
                   { details: { selectionName: selection.name } })
    : new ApiError("forbidden", "This Selection is private");
```

The refusal is chosen from the **Selection's** own state only. A Selection whose
Catalogue is Private may still be public, so the Catalogue's `passwordHash` and
`isPublic` are never consulted here.

Loading and verdicts live in `authorize.ts` beside the Catalogue's:

| Helper                                                 | Answers                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| `loadSelection(catalogueId, selectionId)`              | the live Selection in that Catalogue, or null                   |
| `loadSelectionWithCatalogue(selectionId)`              | `{ selection, catalogue }` when both are live, else null        |
| `readableSelectionFor(viewer, selectionId, grantHeld)` | 404 / 403 `password-required` / 403 `forbidden` / the pair      |
| `memberSelectionFor(userId, catalogueId, selectionId)` | the write verdict: membership of the source Catalogue, then 404 |
| `selectionGrantHeld(c, selectionId)`                   | a usable grant for this Selection, read from its own cookie     |

Uniform 404s hold as they do for Catalogues: a deleted source Catalogue, a
deleted Selection and a private Selection are the same not-found to a visitor,
and the single-work read folds every refusal into one 404.

**The works read is one query and one rule for every audience.** Live works
only — `artworks.deletedAt IS NULL` — ordered by `position, artworkId`, with
**no status filter**: Drafts are included, which is the decision (Q7c, Q13a). A
work deleted in its Catalogue therefore leaves the Selection without any row
being removed, and returns on restore; the `selection_works` row is kept on
purpose.

### Media

The photo proxy is Catalogue-scoped and would refuse a visitor the photo of a
Draft, so the Selection read carries its scope in the URL and the proxy learns a
second admission path. **A Draft in a public Selection renders with its images —
that is the feature, not a tolerated leak.**

- `serializeArtwork` gains an option — `{ selectionId }` — that appends
  `&selection={selectionId}` to every **photo** URL (`variants` included). The
  public Selection reads, the Selection artwork read and the manage read pass
  it; every other read does not.
- `GET /api/v1/media?key=…&selection=…` admits the request when the existing
  Catalogue verdict fails **and** the Selection scope holds: the Selection is
  live and readable for this request (its grant cookie included), the source
  Catalogue is live, and `artworkId` has a `selection_works` row in that
  Selection. Otherwise 404, as the photo branch always is.
- A selection-scoped response is **`private, max-age=3600`**, never `public`: the
  right to the bytes is bounded by a Selection state that the curator can change
  by unpublishing or removing a work, and a shared cache must not outlive it.
- **Documents stay members-only.** The selection scope is accepted for
  `photos` only; a document request is refused exactly as today, so a Selection
  never makes a certificate public.

### The API

Member routes hang off the Catalogue; public routes are flat, mirroring the
Catalogue's address space.

```
GET    /api/v1/catalogues/:catalogueId/selections                     member
POST   /api/v1/catalogues/:catalogueId/selections                     member
GET    /api/v1/catalogues/:catalogueId/selections/:selectionId        member
PATCH  /api/v1/catalogues/:catalogueId/selections/:selectionId        member
DELETE /api/v1/catalogues/:catalogueId/selections/:selectionId        member
POST   /api/v1/catalogues/:cid/selections/:sid/works                  member, append
PUT    /api/v1/catalogues/:cid/selections/:sid/works                  member, replace

GET    /api/v1/selections/:selectionId                                public
GET    /api/v1/selections/:selectionId/artworks                       public
GET    /api/v1/selections/:selectionId/artworks/:artworkId            public
POST   /api/v1/selections/:selectionId/unlock                         public
```

- **Writes** go through a new `selectionWrite.ts`, which takes a `userId` and
  imports no Hono type
  ([the architecture map](../../docs/architecture.md)); routes own status codes
  and the envelope.
- **Create** takes `{ name, description?, isPublic? }`; `isPublic` defaults
  false, `description` empty becomes absent; the id is `mintId()`; the name is
  required and trimmed, as a Catalogue's is.
- **Patch** keeps the app's one PATCH semantics: a value sets, `null` clears
  (`description`, `password`), absent leaves alone. A password write deletes
  every grant row for the Selection **in the same transaction**, exactly as
  `catalogueWrite.ts` does for a Catalogue, including a `null` (removal).
- **Add** takes `{ artworkIds }` and appends in the given order, skipping ids
  already present so a double click is harmless. **Replace** takes the same
  payload and rewrites the list and its positions — that is the reorder and the
  remove. Both refuse an id that is not a live artwork of the source Catalogue
  (`invalid`), and both answer the updated manage read.
- **Delete** stamps `deletedAt`, deletes the Selection's grants and leaves every
  work, photo and the Catalogue itself untouched, in one transaction.
- **Privacy and ordering** of the member list: name order, with each row's
  `workCount` and `updatedAt`.
- **The public read** answers `{ selection, catalogueName, skin, skinOptions,
kind, artworkFields }` — the source Catalogue's name as a credit, plus the
  presentation the Selection inherits (its skin and raw options, its Kind and
  field choices), and never the source Catalogue's id or address (Q16). It
  requires the Selection to be live and readable. The works read answers the
  ordered `Artwork[]` serialized at the viewer's audience, and the single-work
  read folds every refusal into 404.
- **Unlock** mirrors the Catalogue's: 404 if the Selection is missing or
  deleted; 409 if it is not protected (`!isPublic || passwordHash === null`);
  the throttle claim **before** reading the secret, keyed `(ip, selectionId)` and
  sharing `unlockThrottle.ts`'s window and limit; `verifyPassword`; on success
  delete the counter rows, insert a grant with the 12-hour TTL and set the
  cookie `arcula_selection_grant_{selectionId}`, `httpOnly`, `SameSite=Lax`,
  `path=/api/v1`, `secure` in production.
- **Deleting the source Catalogue** takes its Selections' addresses with it: the
  public read joins the Catalogue and answers 404 when its `deletedAt` is set.
  The Selection rows are not stamped, so an operator's restore of the Catalogue
  restores them.
- **No cap.** `limits.ts` is untouched (ADR-0015).

### The shared contract

- `packages/shared/src/types.ts` — `Selection { id, catalogueId, name,
description?, isPublic, createdAt?, updatedAt? }` and the public read's
  `{ selection, catalogueName, skin?, skinOptions?, kind, artworkFields? }`.
- New `schemas/selection.ts`, star-exported from the package index:
  `selectionReadSchema`, `selectionPageSchema` (the member list),
  `selectionCreateSchema`, `selectionUpdateSchema`, `selectionWorksSchema`
  (`{ artworkIds }`, ids checked against `MINTED_ID_RE`, min 1 on add),
  `selectionUnlockSchema` (any non-empty string, as the Catalogue's),
  `selectionPublicReadSchema`. Request types are `z.infer` exports, named for
  their route in the doc comment, as `schemas/catalogue.ts` does.
- `slug.ts` gains `selectionSlug(name, id)`, falling back to `"selection"`, and
  nothing else: `parseId` already recovers the id from the last hyphen.

### The web

- **Routes**, in `apps/web/src/App.tsx`:

  ```
  /selection/:selectionId                        PublicSelectionPage
  /selection/:selectionId/artwork/:artworkId     PublicSelectionArtworkPage
  /selection/:selectionId/pdf                    SelectionPdfPage      (lazy)
  /manage/catalogue/:catalogueId/selections      SelectionsPage
  /manage/catalogue/:catalogueId/selection/:selectionId  SelectionPage
  ```

  Each parses its segment with `parseId`, loads, then canonicalises with
  `selectionSlug` and `replace: true`, gated on the document being readable —
  the rule the Catalogue's pages already follow.

- **Service**: a new `selectionService.ts`, one object literal over
  `/api/v1`, parsing every read through the shared schemas and resolving a 404
  on a single Selection to `null`. No react-query; components call it in effects
  and handlers, as `catalogueService` and `artworkService` do.
- **The public data layer** is a `usePublicSelection.ts` beside
  `usePublicCatalogue.ts`, with the same discriminated union
  (`invalid | loading | error | private | locked | notFound | ready`), the same
  two-call order — Selection first, works second — and the same `publicFailure`
  fold, with `password-required` bubble
  `{ selectionName }` parsed from `details`. The lock screen calls
  `selectionService.unlockSelection` and the page's `reload`.
- **The lock screen is extracted**, not duplicated: the presentational piece
  moves out of `CatalogueLockScreen.tsx` into a `LockScreen` that takes the name
  to show and an `onUnlock` callback, and the Catalogue's page becomes one
  caller. It stays app chrome, outside the skin.
- **The skin contract** grows one view. `SkinProps` becomes a union whose
  `subject` replaces reading `catalogue.name` and `catalogue.description`
  directly:

  ```ts
  type SkinSubject = {
    name: string;
    description?: string;
    catalogueName?: string;
  };
  type SkinProps =
    | {
        view: "home";
        subject;
        catalogue;
        options;
        cataloguePath;
        artworkPath;
        artworks;
      }
    | {
        view: "artwork";
        subject;
        catalogue;
        options;
        cataloguePath;
        artworkPath;
        artworks;
      }
    | {
        view: "selection";
        subject;
        options;
        selectionPath;
        artworkPath;
        artworks;
      };
  ```

  For `selection`, `catalogueName` is the credit line and **there is no
  `cataloguePath`** — the skin must not link the source Catalogue (Q16).
  `options` are the source Catalogue's resolved skin options, so a Selection
  inherits the presentation without a picker. `BasicxSkin` renders the
  selection view through its `Home` layout with the subject, the credit line and
  the works in position order; the add-a-skin checklist gains the third view
  (the skins system is mapped in [the architecture
  map](../../docs/architecture.md)).

- **Public pages** never badge a Draft, never print availability (it is
  member-only on the wire), and never link a work to the Catalogue's artwork
  address: the link is `/selection/{slug}/artwork/{slug}` (Q15).
- **Manage pages.** `SelectionsPage` is the list and the create modal.
  `SelectionPage` is one Selection: a settings block (name, description,
  visibility, password, Delete) and the ordered works list. The list is its own
  component, not `ArtworksTable`: no sort, no paging, a drag handle per row and
  a remove control, each with an accessible name that includes the work's title
  and position. Every mutation refetches, then notifies — the manage area's
  rule.
- **Entry points.** `CataloguePage`'s header gains a **Selections** button
  between **PDF** and the search box (Q18: header, not the kebab).
  `ArtworksList`'s toolbar gains **Add to selection** beside **Delete selected**
  when at least one work is checked; it opens a modal listing the Catalogue's
  Selections plus **New selection**, and appends on confirm.
- **The publish warning** is a confirmation on the transition to public, shown
  when the source Catalogue is not visitor-readable (`!isPublic` or
  `isPasswordProtected`): it names the Catalogue's state and how many of the
  Selection's works are Drafts. A dimmed line on the Selection's page carries the
  same fact while the state holds. Copy follows
  [docs/ux-writing.md](../../docs/ux-writing.md) — concrete, no alarm, the
  number first.
- **The PDF** is a second plan over a work list, not a second exporter:
  `selectionPdfPlan.ts` filters to live works and **keeps position order** and
  Drafts, then reuses the ≤3-photo pages, the six-per-grid pages and the empty
  page. `CataloguePdf`'s document takes `{ title, fields, pages, photoSources }`
  instead of a Catalogue, so both exports share it; fields come from the source
  Catalogue's resolved set. `selectionPdfPlan` is a pure function of
  `(selection, works)` and is tested as one. The access recheck mid-export is
  `recheckSelectionAccess` (mirroring `cataloguePdfAccess.ts`), so a Selection
  unpublished during an export fails the same way a Catalogue made private does.
- **Empty and edge states**, in app chrome: a Selection with no works says so on
  its public page and can still be published; a Selection whose works are all
  deleted reads as empty; a locked Selection shows the lock screen and nothing of
  the page.

### Migrations and release shape

The migration ships **alone** — additive tables only, no code that reads them —
because the Lambda deploys before the migration runs
([AGENTS.md](../../AGENTS.md)). The feature ships in the next release, and the
handler keeps no fallback: unlike `mediaNamespaceId`, these tables are not read
by code that predates them.

## Testing Decisions

The tiers and mechanics are [docs/testing.md](../../docs/testing.md). What each
tier must pin:

- **Pure unit — the verdicts.** `canSeeSelection`'s matrix: member of any status;
  public unprotected; public protected with and without a grant; private with a
  grant still refused; deleted source Catalogue refused; deleted Selection
  refused. The source Catalogue's visibility is varied against every cell and
  must not move a single answer — that is the decision, and the test that fails
  if someone "tidies" the verdict back into inheritance.
- **Pure unit — the works.** Position order including a duplicate position,
  Drafts included, deleted works excluded, restore rejoining, and the empty list.
- **API integration.** Create → add → reorder → publish → unlock → read, against
  the real stack (`bun run test:api`). Publish from a private Catalogue must be
  allowed and readable; unpublish and delete must answer 404; a password write
  must revoke grants; the throttle must answer 429 and must not block a second
  Selection from the same address; deleting the source Catalogue must 404 every
  Selection without stamping its rows; renaming must change the slug the client
  builds and nothing the server looks up.
- **Media proxy.** A Draft's photo is 404 to a catalogue visitor and 200 through
  a readable Selection; a private Selection's scope is 404; a protected one
  without the grant is 404; a document is still 403; the cache header is
  `private`.
- **Shared.** The request schemas refuse an empty add, a duplicate id in a
  replace, an id with a hyphen, and an unknown key; the read schema refuses a
  document carrying `passwordHash`.
- **Web.** The public pages' five states and the slug rewrite; the lock screen
  extracting cleanly for both callers; the skin's selection view with the
  subject and no Catalogue link; the manage list's add/remove/reorder; the
  publish confirmation's copy including the Draft count; the PDF plan's order.
- **Mutation bar.** Each of the above is accepted only when changing the line it
  claims to cover turns it red — the verdict's `selection.isPublic`, the
  works' `position`, the cookie's Selection id, the plan's sort, the warning's
  condition. The tests that fail if Mantine or Hono changes are not wanted.

## Out of Scope

- Selections on the agent surface (no MCP tool creates or edits one).
- A Selection spanning more than one Catalogue.
- A per-Selection skin, or a skin picker on the Selection.
- A dashboard section listing every Selection an account can reach.
- Per-work captions, notes or ordering inside a Selection beyond `position`.
- Showing `availability` — "For sale", "Sold" — to a Selection's readers; it is
  member-only, and widening it is a separate decision about that fact.
- A cap on how many Selections a Catalogue may hold.
- Restoring a deleted Selection from the app.
- Selection search or facets.

## Further Notes

- **The word.** "Selection" names the entity; the artwork manage view's checked
  works are **checked works** in new copy and never "Selection". The glossary's
  entry carries the disambiguation, and `ArtworkBulkSelectionPayload` keeps its
  name because a rename is not owed to a payload type.
- **Why one entity and not two.** A Selection is not a second Catalogue: it owns
  nothing, has no Kind, no members and no media, and every write it accepts is a
  curation decision. That is why it borrows the Catalogue's skin, fields and PDF
  rather than repeating them.
- **The seam to watch.** Two gates over one work means two read paths and two
  media admissions. Any new read that forgets `selectionId` will look correct in
  a public Catalogue and fail on the first Draft in a Selection — which is why
  the media tests above are written against a Draft, not a Published work.
