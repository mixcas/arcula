# Artwork fields are a per-Catalogue choice from one fixed registry

**Status**: accepted

Every Artwork in every Catalogue was asked the same fourteen fields. A Portfolio
was asked what the artist paid for their own work, and when they acquired it; an
Inventory was asked the acquisition price of a work it only represents and, on
consignment, never owned. The one per-kind difference in the record was
Availability, and even that was a rule rather than a choice: a Collection's works
carried none because the Kind said so, not because the collector did not sell.

So a member with a simple Catalogue — titles, dimensions, photos — paid for the
unused fields on every work: in the form they skipped, in the Catalogue PDF that
printed what they never filled, and in search results that matched text they did
not mean to keep.

The decision is that **which fields an Artwork records is a per-Catalogue
choice**, made from one fixed registry and resolved against the Kind's defaults.
The Kind is a starting point, no longer a fence: every field is available on
every Kind, and Availability is a field like the other twelve.

## Decision

**One registry owns the whole answer.** `packages/shared/src/artworkFields.ts`
holds the thirteen togglable keys, the two fixed ones, the per-Kind defaults, the
resolver, the normaliser and the one predicate that answers which named fields a
Catalogue does not record. The server that refuses a disabled field and the
client that renders the form cannot disagree, because they call the same module.
The togglable type is derived from the Artwork form's values with `title`,
`artistName` and `status` excluded, so a field added to the form fails the build
until it is placed in the registry.

**Title and Artist Name are always recorded and are never switches.** They are a
work's identity: lists, addresses and the PDF name it by them. Photos and Other
Documents are not listed at all — they are media the record owns, not fields of
it — and Status stays where it is, the Draft/Published stamp rather than a field.
The thirteen are `serie`, `dateOfCreation`, `medium`, `dimensions`, `editions`,
`acquisitionDate`, `acquisitionPrice`, `placeOfOrigin`, `provenance`, `notes`,
`condition`, `currentValue` and `availability`.

**The defaults are the Kind's, and only the defaults.** Everything starts on,
except the acquisition pair, which starts off on a Portfolio (an artist did not
acquire their own work) and on an Inventory (a gallery records what it
represents, and on consignment it never held title), and Availability, which
starts off on a Collection (a collector records what they own, not a market
state). Provenance and Condition stay on everywhere: a condition report is as
useful to an artist as to a collector, and narrowing further would be guessing.
A new Catalogue is its Kind's defaults with nothing stored.

**Storage is a sparse map of deviations, not a list of disabled fields.** The
Catalogue row carries a nullable jsonb, `collections.artworkFields`, holding
`Partial<Record<ArtworkFieldKey, boolean>>`. An absent key follows the Kind's
default; an entry is a choice the member made. A disabled list could not express
"on although the default is off", which is exactly what a Portfolio enabling
`acquisitionPrice` needs. `null` and `{}` both mean pure defaults.

**Normalised on save.** The write path drops entries that equal the Kind's
default and stores `null` when nothing is left, so "back to the defaults" is a
state the member lands in rather than an action they must find. Reset sends an
empty map.

**The wire carries the deviations, on every audience.** The Catalogue read
returns the sparse map rather than the resolved set, visitors included: the
public Catalogue PDF is an ordinary public address and resolves the same enabled
set a member does. The map reveals only which fields a Catalogue records, never a
value. Keeping the deviations on the wire is also what lets the settings page
tell "untouched" from "chosen" without a second key.

**A save that names a disabled field is refused.** The Artwork create and update
routes resolve the Catalogue's enabled set after parsing and before the
transaction opens, and throw `field-disabled`, mapped to `400`, with the
offending field names in the envelope's `error.fields` and in the message
("Provenance is not recorded in this catalogue."; `apps/api/src/artworkFieldRefusal.ts`).
Zod cannot make this check, because the disabled set is per-Catalogue and the
schemas strip unknown keys. It is a new code rather than the existing
`field-not-writable`, because the remedy differs: a stale form must re-read the
Catalogue, not stop sending a server-managed field.

**The readers follow the same set.** The Add and Edit forms render a field only
while it is enabled, and their save omits a disabled key entirely rather than
clearing it, so a hidden value survives. Catalogue search always reads Title and
Artist Name and reads the other eight searchable fields only while the Catalogue
records them, so a disabled field's stored text stops matching. The Catalogue
PDF's printed columns are filtered by the enabled set; Title and Artist Name
always print, and the layout, the ordering and the photo pages do not change.
The CSV import offers only enabled fields as mapping targets, strips a disabled
key from each row before validation, and names the skipped columns in its run
summary. A field outside the import's vocabulary — Availability is one — was
never imported and stays that way.

**The settings card.** A sibling card after the privacy section on Settings ›
General, titled _Artwork fields_: the statement that Title and Artist Name are
always recorded, two switch groups — _About the work_ and _Market & acquisition_,
with the four market fields carrying a line of explanation each — and a header
line reading "Using the Portfolio defaults" or "Customised · Reset to defaults".
It saves with the tab's existing single Save; a second save button on one tab
would break the page's doctrine. Any member may change it, owner and collaborator
alike, like the rest of Settings. A hidden field that still holds a value gets no
affordance in the Artwork form: the settings card is the one place the record's
shape is decided.

**Availability is flattened.** All four states — `available`, `reserved`,
`sold`, `on-consignment` — are offered on every Kind, and the Kind surface no
longer carries a per-Kind list. Whether Availability is in play is simply "the
Catalogue records the field", so the manage table's badge, the grid's badge and
the Deleted view's badge follow the configuration rather than the Kind. A new
work starts at `available` when the field is enabled.

**The label moves, the key does not.** `currentValue` is labelled **Current
price** in the form, the settings card and the import metadata. The stored key,
the wire key, the database column and the CSV column identity do not move: a
label does not earn a migration.

**Two releases, in this order.** Release 1 was one additive, nullable migration
adding the column, plus the schema declaration and its structural test; nothing
read it (`0011_catalogue_artwork_fields`). Release 2 is the registry, the
contract, the API, the web surfaces and this record. AGENTS.md requires a schema
change to ship alone because the deploy replaces the Lambda before it migrates,
and this was a plain add-nullable, so the generated migration needed no hand
edit.

## Rejected alternatives

- **Per-Kind schemas.** Already rejected in
  [ADR-0010](0010-collector-artist-and-gallery-are-catalogue-kinds-not-account-roles.md),
  and for the same reasons here. A per-Kind schema makes a new Kind a migration
  rather than a presentation change, splits every read into a union, and would
  have to be replicated by a client that must render a form before it knows the
  server's answer. The Kind's defaults give each persona its starting shape
  without giving up one superset row.
- **User-defined custom fields.** A member adding "Frame", "Insurance value" or
  "Exhibition history" would create a second, unbounded vocabulary that every
  reader has to cope with: a label, a type, a search rule, a place in the PDF, an
  import target and a settings control, none of which exists for a field the
  product has not defined. The thirteen cover the domain; adding one is a
  release, not a member's configuration.
- **Skin-controlled visibility.** A skin decides how a Catalogue is presented,
  not what its record contains. Which fields a Catalogue records is the member's
  choice; the layout stays the skin's. An option per field would put the record's
  shape into a presentation vocabulary, so two skins would disagree about the
  same Catalogue and switching skins would silently change which fields a member
  is shown. The Basicx option doctrine already says the skin chooses which fields
  _appear_; it does not choose which fields _exist_. That is the one clause the
  doctrine gained.
- **A full snapshot instead of deviations.** Storing every field's state on every
  Catalogue makes a later default change unable to reach a Catalogue that never
  touched the field, and makes a new field's arrival a backfill of every row. It
  also cannot tell "untouched" from "chosen", which is what the settings card's
  defaults/customised line and its Reset need. The sparse map is smaller and lets
  an untouched Catalogue follow the product.
- **Per-Kind availability states.** Keeping a per-Kind list would be a second
  gate beside the field's own on/off, and the flattening is exactly what removes
  it: a Portfolio that sells on consignment could not record it while the same
  field on an Inventory could. One list of four on every Kind is worth more than
  the distinction.
- **A disabled list instead of a deviations map.** It cannot express a field
  explicitly switched on against a default of off, which is the direction a
  Portfolio enabling `acquisitionPrice` most needs. The deviations map is no
  larger and says both directions.

## Consequences

- **A Catalogue that never deviated follows its Kind's defaults as they move.**
  A later change to a default reaches it, and a newly added field arrives
  according to its default. A member who explicitly touched a field keeps that
  choice. That is the accepted trade for reset being free and for needing no
  migration, and it is why the stored map is a deviation map rather than a
  snapshot.
- **A stored entry that has come to equal the current default is normalised
  away.** When a save normalises the map, an entry whose value now equals the
  Kind's default is dropped, even if the member once chose it deliberately. The
  resolved value is the same at that moment, which is what makes the drop safe,
  but the choice is no longer protected from a later move of the default. This
  was flagged as an ambiguity in #301 and is accepted: keeping the choice would
  require a second stored flag per field, which is the snapshot this record
  rejects.
- **Flattening Availability is a visible loss.** A Portfolio may now record
  `on-consignment`, and the product can no longer say that only a gallery's
  inventory offers it. The four states are otherwise identical across Kinds, so
  one list is worth more than the distinction.
- **Sparse deviations need no migration.** No backfill, no data migration: an
  existing Catalogue is its Kind's defaults on the day the feature ships.
- **The deploy order is load-bearing.** The column's release had to land and
  deploy before the feature's, in both environments. A revert of the feature
  leaves a harmless unused column; the same is not true of reverting the column's
  release after the feature shipped.
- **A disabled field keeps its data.** Stored values are never deleted, cleared
  or backfilled, and a field switched back on returns with them intact. The form,
  search, the PDF and the import simply stop reading it. There is no UI for a
  hidden value and no report of it.
- **The public read carries the deviations.** They reveal which fields a
  Catalogue records, which is not a value and not a gate; the public Catalogue
  PDF needs them to print the Catalogue it claims to be.
- **Not built here.** User-defined fields, per-field required/optional, custom
  labels, reordering or grouping by the member, per-field permissions, a column
  chooser for the manage table, a UI for hidden values that still hold data,
  renaming `currentValue`, and any change to what a skin renders. The Draft/
  Published stamp, the Catalogue's visibility and Selections are untouched.
