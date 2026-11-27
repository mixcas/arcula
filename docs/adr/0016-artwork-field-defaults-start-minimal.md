# A new Catalogue's Artwork fields start minimal

**Status**: accepted

[ADR-0013](0013-artwork-fields-are-a-per-catalogue-choice.md) made which fields
an Artwork records a per-Catalogue choice, and put almost every field on by
default: only the acquisition pair (Portfolio and Inventory) and Availability
(Collection) started off. The reasoning was that each field is useful to
someone, and a member could switch off what they did not need.

In practice that made the Kind's defaults a formality. A new Catalogue opened a
long Add form, and the settings card said "Using the Portfolio defaults" while
eleven of thirteen switches were on — so the default was not a considered shape
for that Kind, it was everything. A member with the common case — titles,
dimensions, photos, the occasional note — skipped the same fields on every work
until they found the card. The product's own bet is that art is not tidy data:
an unset field is not an empty one. That argues against requiring fields, not
for showing all of them.

The decision is that **the defaults start minimal, and expansion is the
member's move.** A field that is on by default is a field a new user must
notice, decide about and skip on every work; a field that is off is one switch
away, and its arrival costs one visit to Settings rather than a daily skip.

## Decision

**The common core is Date of creation, Medium, Dimensions and Notes.** They are
on on every Kind, because they are what makes a work legible in a list, a PDF or
a search result. Title and Artist Name remain fixed and are always recorded.

**Four fields start off on every Kind: Serie, Editions, Condition and Current
price.** They are real, and a Catalogue that needs them switches them on; none
of them is part of the common case, and Current price in particular is a
collector's or a gallerist's concern rather than an artist's.

**The Kind adds its own shape on top of that core.**

| Field             | Portfolio | Collection | Inventory |
| ----------------- | :-------: | :--------: | :-------: |
| Date of creation  |    on     |     on     |    on     |
| Medium            |    on     |     on     |    on     |
| Dimensions        |    on     |     on     |    on     |
| Notes             |    on     |     on     |    on     |
| Serie             |    off    |    off     |    off    |
| Editions          |    off    |    off     |    off    |
| Condition         |    off    |    off     |    off    |
| Current price     |    off    |    off     |    off    |
| Acquisition date  |    off    |     on     |    off    |
| Acquisition price |    off    |     on     |    off    |
| Place of origin   |    off    |     on     |    on     |
| Provenance        |    off    |     on     |    on     |
| Availability      |    off    |    off     |    on     |

A Portfolio is a solo artist's own body of work: it shows the four common
fields and nothing market-shaped. A Collection is what a collector bought, so
the acquisition pair and the history fields stay. An Inventory is what a gallery
represents, so provenance, place of origin and Availability stay while the
acquisition pair does not — on consignment the gallery never held title.

**Nothing else changes.** Storage is still the sparse deviation map normalised
against the Kind, so no migration is needed: a Catalogue whose map is `null`
follows the new defaults from the deploy on, and a Catalogue whose member chose
a field keeps that choice. A disabled field keeps its stored values; the form,
search, the PDF, the CSV import and the agent surface simply stop reading it,
exactly as ADR-0013 designed.

## Consequences

- **Every untouched existing Catalogue opens a shorter form after the deploy.**
  This is the intended reach of the change, and it is why the map is a deviation
  map rather than a snapshot. A value recorded while a field was on is kept and
  returns if the field is switched back on; there is no UI for the hidden value
  and no report of it, which is ADR-0013's accepted trade.
- **The settings card now means something.** "Using the Portfolio defaults" is
  a shape a member can tell apart from "Customised", and Reset lands on the
  minimal set rather than on almost-everything.
- **The minimal default is a product decision, not a per-account one.** A
  member who wants the full set visits Settings once per Catalogue. There is no
  account-level default and no onboarding prompt offering one; both were
  rejected below.
- **The table is pinned in one test.** `packages/shared/tests/artworkFields.test.ts`
  carries the literal matrix, so a default that moves is a deliberate change to
  two files rather than a silent drift.
- **This supersedes ADR-0013's defaults, not its mechanism.** The registry, the
  deviations map, the normalisation, the refusal and every reader stay as that
  record describes.

## Rejected alternatives

- **Keep the all-on defaults and improve onboarding.** A tour or a first-run
  hint teaches the card once; the fields are still skipped on every work until
  the member acts. The friction is per-work, and a default is the only thing
  that can remove it.
- **Everything off but Title and Artist Name.** A Catalogue with no date, medium
  or dimensions is not a catalogue a visitor can read, and it would make the
  first work an exercise in Settings rather than in describing art. The common
  core is the smallest set a work can be legible with.
- **A different minimal core per Kind.** The four common fields are the same
  words on every surface; varying them by Kind would mean a Portfolio renders a
  different form for no reason a member could predict. Only the market fields
  earn a Kind distinction.
- **Ask at creation which fields to record.** It adds a step to the exact moment
  this decision is trying to shorten, and it asks a new member to decide about
  fields before they have entered a work. The settings card is the better place
  for that choice, after the record has a shape they can see.
- **An account-level default or a field preset ("artist", "gallery", "simple").**
  That is a second configuration layer over a per-Catalogue choice, and it would
  have to be resolved before the Kind's defaults, replicated on the client and
  explained. The Kind already is the preset; it just starts smaller now.
- **Hide the market fields only on a Portfolio and leave the four universal
  fields on everywhere.** That was the shape closest to ADR-0013, and it keeps
  Condition and Current price in front of every artist. The friction the change
  targets is the same on every Kind, so the four start off on every Kind too.
