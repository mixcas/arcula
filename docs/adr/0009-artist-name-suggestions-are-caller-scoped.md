# Artist Name suggestions are scoped to the collections the caller can read

**Status**: accepted

A collector types the artist's name by hand on every work. Nothing remembers the
names already recorded, so the same artist drifts into several spellings across a
collection — "Pablo Picasso", "pablo picasso", "PICASSO Pablo". Those spellings
then behave as different artists: the Artist Name A-Z sort interleaves them, the
Collection search treats them as separate facts, and the Collection PDF prints
whatever each work happens to say. The field is slow to fill as well: long names
with diacritics and punctuation are retyped for every work by the same artist.

The obvious fix — suggest the names already in the database — runs straight into
the access model. A naive list over every account's input would tell any signed-in
account which artist names exist inside collections it cannot read, private
collections and other people's drafts included. That is the side channel
[ADR-0003](0003-the-collection-gates.md) exists to close. The Artist Name field
becomes a suggestion input without becoming one: the suggestions come from the
collections the caller can already read, so the field gets faster and the access
model stays exactly as it is.

The vocabulary is in [GLOSSARY.md](../GLOSSARY.md): **Collection**, **Owner**,
**Collaborator**, **Artwork**, **Draft**, **Deleted**. There is no **Artist**
there and this decision adds none: **Artist Name** remains a free-text field on
an Artwork, and the suggestions are derived from the artworks themselves.

## Decision

**The scope is the caller's readable collections, never the database.** A
suggestion is an Artwork's `artistName` whose Collection the caller owns or
collaborates on. The query mirrors the signed-in `/collections` list — one join
to the caller's collaborator row, filtered on live Collections and on
`owner = caller OR collaborator = caller` — so a name from a collection the
caller could not open is never read. Deleted Collections are excluded for the
same reason they are not found on any path
([ADR-0008](0008-a-collection-is-deleted-by-its-owner.md)): a collection the
caller removed must not keep influencing their typing. A collaborator's
suggestions are computed per caller, so the owner never sees them.

**Every name in the response is already readable by the caller.** That is the
whole safety property, and it is what separates this read from a directory. The
caller could open each contributing Collection through the ordinary collection
read and read the same artist name from the same Artwork; the suggestion endpoint
adds convenience, not disclosure. Nothing in the response names a Collection, an
Artwork or a count, so it reveals nothing beyond the vocabulary itself.

**The read is caller-scoped, not Collection-scoped.** `GET /api/v1/artist-names`
takes no Collection id and has no request parameter. The resource is the caller's
artist vocabulary, not one collection's, and the caller comes from the session.
It is deliberately not nested under `/collections/{id}`: the collector's
vocabulary spans every collection they can read, so naming one would narrow the
answer to a fraction of it. No session is `401 unauthorized`; a caller with no
Collections is `200 []`, not an error.

**Eligible rows are the live works, drafts included.** The aggregate filters
`artworks.deletedAt IS NULL`: a Draft contributes, because it is part of the
Collection and a member reads it, while a Deleted work does not, because the list
should reflect the library the collector actually has. Blank and whitespace-only
names are dropped. The current artwork's own name is not filtered out, so the
field's state is reflected honestly while editing.

**The database aggregates exact spellings; the collapse is a pure function.**
Inside the scope the query groups by `artistName` with `count(*)` and
`max(updatedAt)`. Turning those spellings into one option per artist is a pure
function over the rows that trims each name and then applies `normalizeSearchText`
— Collection search's own NFD, diacritics-stripped, lowercased normalization,
exported from `packages/shared/src/artworkSearch.ts` — so "María López" and
"Maria Lopez" are one artist here exactly as they are one search term there. For
each normalized key the winning spelling is the most-used one; a count tie falls
to the most recently updated work, and a remaining tie to lexicographic order, so
the answer is deterministic. The list is ordered by count descending, then
display name ascending and case-insensitively, and truncated at **2,000** names.
Truncation is silent: a suggestion list is a hint, not the data.

**The wire is the names alone.** The response is a JSON array of canonical
spellings, parsed through a shared schema of non-empty strings on both sides.
Counts are an ordering input and are never serialized; the dropdown shows the
name alone. There is no migration, no index and no Postgres extension: grouping
the exact spellings and collapsing in JavaScript keeps this a code-only change,
and `artistName` stays unindexed.

**The field is an `Autocomplete` with one fetch per mount.** `Autocomplete` is
free text by contract, which is what Artist Name is; `Select` would forbid a name
that has never been recorded. The control stays uncontrolled like every field in
the form, so choosing an option fills only this field and a save never rewrites
another work. A small hook loads the list once when the form mounts, with no
debounce, no per-keystroke request and no cross-mount cache: reopening the form
is what refreshes it. Failure is silent — an empty list leaves the field as a
plain text input and shows no notification, the same best-effort stance the
product takes with mail. Filtering is Mantine's default, accent-sensitive
substring matching, and at most twenty options render; there is no minimum
length in this version, because with a single fetch there is nothing to gate.

**The future index is the recorded direction, and it reopens this question.** The
long-term goal is a much larger artist-name index, curated and crawled from user
input and external sources. Such an index would be far larger than any one
account's library, and it would **not** inherit the read's safety property: a
name in it could come from outside the caller's readable collections, so its
authorization model has to be decided when it exists, not assumed from this one.
The aggregate lives in a module with no Hono types, behind the route contract, so
that index can replace the module's source without changing the wire.

## Considered Options

- **A global index over every account's input.** Rejected. It is the obvious
  implementation and the one that turns a convenience into a side channel: any
  signed-in account could learn the artist names inside private collections and
  other people's drafts, which is precisely what the collection gate
  ([ADR-0003](0003-the-collection-gates.md)) and membership
  ([ADR-0004](0004-collections-are-shared-by-membership.md)) keep closed. A
  faster text field is not worth a new visibility leak.
- **A Collection-scoped endpoint, `GET /collections/{id}/artist-names`.**
  Rejected. It is narrower than the resource: the collector's vocabulary spans
  every collection they can read, so editing a work in one collection would lose
  the names already known from another. It would also tie a caller-wide
  convenience to whichever collection the form happened to be open in, and ask
  the access question per collection when the caller's identity already answers
  the only question there is. Caller scope is both the wider and the safer set.
- **No endpoint at all, leaving the field plain text.** Rejected. The problem —
  retyped names and spellings that drift into separate facts — stays, and the
  read is cheap, derived and discloses nothing beyond what the caller can already
  read. Adding it does not widen the access model; declining it does not protect
  anything the scope has not already protected.
- **A normalized Artist table, with ids and rename propagation.** Rejected. It
  invents the Artist entity the product does not have, for a field that is
  deliberately free text, and it would need merging of existing spellings and a
  migration to earn its keep. Suggestions can converge the vocabulary as works
  are saved without making one work's edit rename another.

## Consequences

- **No schema change.** The read is derived, so no table, column, index or
  migration ships and the forward-only rule is untouched. The failure mode when
  the aggregate becomes slow is evidence for the future catalogue, not for a
  speculative index on `artistName`.
- **The access model is unchanged.** No new verdict and no new loader: the scope
  query is the signed-in list's shape, and membership remains the one write
  question. A name can enter the response only through a collection the caller
  can already open, so the endpoint adds no authorization surface.
- **Wire.** One new member-only read, `GET /api/v1/artist-names`, with
  `401 unauthorized` as its only failure and `200 []` for an empty scope. No new
  error code ships; the shared schema (`array of non-empty strings`) is the
  contract on both sides.
- **An accepted client gap.** The stored collapse ignores accents while
  Mantine's default filter does not, so typing `maria` does not match a recorded
  "María López". That is a matching refinement, not a scope leak, and it is
  deliberately deferred.
- **The cap is the tripwire.** 2,000 names fit comfortably in one response for
  any real library. If a caller approaches it, the next step is server-side `?q=`
  filtering with a debounce, and the four-character gate returns as request cost
  control rather than as dropdown policy.
- **Tests.** The collapse, ordering, tie-breaks and silent truncation are pure
  and tested directly. The API integration suite pins the scope and the wire: an
  owner's and a collaborator's names are suggested, a stranger's are absent, a
  draft contributes, a deleted work and a deleted collection do not, two casings
  collapse to one option, the order is by use, an anonymous caller is `401` and a
  caller with no collections is `[]`. No component test is added: the remainder
  is Mantine's dropdown behaviour, and the fail-silent path's only observable
  difference is which mock was called.
- **Design record.** `DESIGN.md` describes the read in the API section and the
  field's single fetch and silent failure in the frontend section; the agent
  guide's module map names `artistNames.ts` and what it owns. The glossary is
  unchanged, because no Artist entity exists.
