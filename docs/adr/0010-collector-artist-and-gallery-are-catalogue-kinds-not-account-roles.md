# Collector, artist and gallery are Catalogue kinds, not account roles

**Status**: accepted

Arcula was built for one audience — a collector who owns the works — and that
audience was never a field on the account. It was baked into the artwork's field
vocabulary (`acquisitionPrice`, `currentValue`, `provenance`, `condition`), into
the free-text `artistName`, and into the assumption that a collection is "the
things I own". Galleries and artists need the same unit — a named set of
artworks, shared, tiered, given a public page — but different words for it and
different fields inside it. The decision is that the collector/artist/gallery
axis is a **kind** on the unit, never a role on the account; and the unit's name
changes from Collection to **Catalogue**, because "Collection" becomes one of the
kinds.

## Decision

**The account stays a plain node.** An account is the owner or a collaborator of
any number of Catalogues of mixed kinds, all at once — a Portfolio of the work it
makes, a Collection of what it owns, an Inventory of what it represents. Nothing
on the account records which of these it is, because it can be several. The
owner/collaborator relationship
([ADR-0004](0004-collections-are-shared-by-membership.md)) is the only "role",
and it is unchanged. The word _role_ in this record's title means the audience,
and the two must not be confused: a Catalogue's kind names whose art it is and
why it is held; an account's relationship to a Catalogue names what it may do to
it.

**The unit is the Catalogue, and `kind` says whose art it is and why it is
held.** `catalogues.kind` is one of `portfolio`, `collection` or `inventory`,
NOT NULL with a default of `collection` (the existing rows are all a collector's),
and fixed at creation. The kind shapes the surface, not the schema: every
artwork field stays valid on every kind, and the kind decides which fields a
form shows and requires and which statuses are available. A column that only
some kinds surface — availability — still lives on every work and is simply
ignored where the kind does not use it.

**The Catalogue's own two fields are reinterpreted, not replaced.** `name` and
`description` are the entity's name and its prose, and the kind relabels them. On
a Portfolio `name` is the artist's name and `description` is their bio; on an
Inventory `name` is the gallery's name and `description` is about the gallery; on
a Collection they are the collection's name and its description. No new column
names the entity — `name` already does, and the URL slug already derives from it,
so a Portfolio's public address is the artist's name for free. This is the
subject/manager distinction without an entity: `catalogues.name` names whose art
it is, `catalogues.userId` names who administers it.

**Availability is a second axis on the works of two kinds.** A work in a
Portfolio or an Inventory carries an availability — for sale, reserved, sold —
beside its `published`/`draft` status, which remains about visibility. A
Collection has no availability: its works carry acquisition price and current
value instead. The exact availability values are the spec's, not this record's.

**The rename reaches everything above the storage layer.** The wire type, the
routes (`/api/v1/collections` → `/api/v1/catalogues`), the UI, the docs and the
glossary all say Catalogue; the Drizzle entity is `catalogues`. The physical
Postgres table stays `collections` for now: renaming it is a non-additive
migration that collides with the deploy-before-migrate order, and the physical
name is invisible. The later, disciplined path is a view-staged rename — one
migration renames the table to `catalogues` and creates a `collections` view over
it, so both names keep resolving; the code then moves to `catalogues`; and once
nothing reads the old name, a later migration drops the view — recorded here so
it is not reinvented.

**Selection is a rename, not a decision.** The roadmap's "Catalogue" — a curated
subset on its own address — is renamed Selection, freeing the word for the
umbrella. Selection is a second dimension (a view over works), not a fourth kind;
its access model still needs its own decision when it is built.

## Considered Options

- **An account-level role, or a role picker.** Rejected. One person is several
  of these at once — a gallery that also collects, an artist who also owns — and
  a role on the account cannot express the overlap without a matrix of flags. The
  account stays neutral; the kind lives on the thing it describes.
- **Separate accounts per role.** Rejected. It forces one identity to fragment
  into several, which is the account-level-role problem under another name.
- **An organization entity above Catalogues.** Deferred, not rejected. A gallery
  is a brand with staff, but the owner-plus-collaborator model already expresses
  "many people, one set of works", and no gallery has yet needed a nameable body
  that owns Catalogues. Revisit when one does.
- **"Inventory" as the umbrella.** Rejected. It is the right word for the gallery
  kind, so it cannot also be the generic unit without the very clash this rename
  resolves.
- **"Archive" or "Folio" as the umbrella.** Rejected. Each carries a connotation
  — archive reads as finished or put-away, folio is a near-synonym of portfolio —
  that leans a neutral unit toward one audience. Catalogue was already the verb
  the product is built around ("cataloguing a collection"), and the art world
  uses it for all three kinds: a catalogue raisonné, a collection catalogue, a
  gallery catalogue.
- **A `subjectArtistName` column on a Portfolio.** Rejected. The Catalogue's
  `name` already names the entity; a second column would drift from it.
- **A first-class Artist entity.** Rejected for now. Free-text `artistName`
  already groups, sorts and collapses spellings
  ([ADR-0009](0009-artist-name-suggestions-are-caller-scoped.md)), and the one
  thing it cannot do — attach a bio or statement to a name — is exactly what a
  Portfolio's `description` now holds. The entity returns only if a need forces
  it (a roster, a bio that is not a Catalogue's description), with its own
  decision then.
- **Per-kind schemas.** Rejected. One superset schema keeps every field valid on
  every kind and makes a new kind a presentation change rather than a migration.

## Consequences

- **Schema.** Two additive columns, each its own release: `catalogues.kind`
  (NOT NULL, default `collection`, fixed at creation) and
  `artworks.availability` (nullable; its values are the spec's). `kind`'s
  default is a constant, so it needs no backfill step; `availability` is
  nullable because a Collection's works carry none. Neither needs a destructive
  step.
- **The rename.** Everything above storage says Catalogue; the physical table
  stays `collections` until the view-staged rename above. `name` and
  `description` keep their columns, their requiredness and their validation; only
  the labels change per kind.
- **No new entity.** There is no `artists` table, no `artworks.artistId`, and no
  `user ↔ artist` link. `artistName` remains free text and the suggestions
  feature is untouched
  ([ADR-0009](0009-artist-name-suggestions-are-caller-scoped.md)).
- **Glossary.** Catalogue (umbrella), Portfolio, Collection (kind), Inventory,
  Kind, Availability and Selection are defined; Collection stops being the
  umbrella and becomes a kind; Collector, Owner, Collaborator and the visibility
  terms read "Catalogue" where they read "collection".
- **Deferred.** The availability enum, the Selection access model, the physical
  table rename, an organization entity, and the Artist entity. The tier cap
  still counts owned Catalogues; whether a kind changes the allowance is a
  tiering decision, not this one.
