# A Selection is a second gate over its Catalogue's works

**Status**: accepted

A **Selection** is a curated, ordered subset of one Catalogue's works, given its
own address and its own audience: Public, Private or Protected, independently of
the Catalogue's own. It references works and never copies or edits them. The
decision is that a Selection is a **second gate** — it may publish a work its
Catalogue has not, and a private Catalogue may have a public Selection — rather
than a narrower window onto the Catalogue's gate.

## Decision

**The Selection is an entity, not a view or a filter.** It has a name, an
optional description, its own address, its own visibility and its own password,
and an explicit position for every work it holds. Its address is top level —
`/selection/{slug}-{id}` — because nesting it under the Catalogue's would imply
the Catalogue's gate still applies, which is the thing this record rejects.

**Its audience is its own, and that is deliberate.** A work is public when a
public Catalogue lists it **or** a public Selection includes it
([GLOSSARY](../../GLOSSARY.md), **Public**). A curating member can therefore take
a work to an art fair in a public Selection while the work stays a Draft in a
private Inventory. The cost is accepted explicitly: a public Selection can
expose works the Catalogue's own page hides, so the moment a Selection is
published while its Catalogue is Private or Protected the app must warn, and
that warning names the number of Drafts it will reveal. The API does not block
the write; the curator's deliberate act is the guardrail.

**A Selection has no members.** Its readers are **Visitors**
([GLOSSARY](../../GLOSSARY.md)), never collaborators. The source Catalogue's
owner and collaborators curate every Selection cut from it — create, rename,
reorder, publish, delete — because membership is already the write verdict for
everything inside a Catalogue
([ADR-0004](0004-collections-are-shared-by-membership.md)). A second membership
matrix would mean a second invitation flow, a second owner to transfer and
orphaned Selections whenever a Catalogue changes hands, for a feature whose job
is to be a link somebody opens.

**It is a live lens.** The Selection stores references, never a snapshot: a
renamed work shows its new title, a new photo appears, a work deleted in its
Catalogue leaves the Selection and returns on restore. A work's
`published`/`draft` status is **not** consulted — a Selection shows the live
works it lists, whatever their status — so the two statuses keep their meaning:
`published` puts a work on the Catalogue's own page, `draft` keeps it off. No
third status is added and neither word is renamed.

**The presentation and the export are the Catalogue's.** A Selection renders in
its source Catalogue's **Skin** and Skin options, with one new view in the skin
contract; it prints the Catalogue's **Artwork fields** and never a choice of its
own; its **Selection PDF** is the curator's position order with Drafts included.
It names its source Catalogue without linking it, because the Catalogue's
address is a different gate and is often unreadable — a dead link or a lock
screen is worse than a name.

**It is not advertised.** A public Selection is reached by link only: not in the
public catalogue list, not on its Catalogue's public page, not on the dashboard.
That is what makes publishing one from a Private Catalogue safe to offer.

**It is deleted with a stamp**, like a Catalogue, and it spends no tier
allowance — the cap counts owned Catalogues, and a Selection owns nothing.

**The agent surface waits.** No MCP tool creates or edits a Selection in this
release. The deferred question is real: an agent's import lands as Drafts
precisely because a conversation is not a review, and a Selection is now the one
surface on which a Draft can become visitor-visible.

## Considered Options

- **A narrower window: the Selection can only narrow the Catalogue's gate.**
  Rejected. It was the conservative reading, and it fails the case the feature
  exists for — a fair Selection of works the gallery has not put on its public
  page. It also makes "own audience" mean only "own password", which the
  roadmap did not ask for.
- **A token link instead of an address.** Rejected. It cannot be renamed, cannot
  be protected separately, and duplicates the access model the Catalogue already
  has.
- **A snapshot of the works at publication.** Rejected. It duplicates the record
  and makes every later edit a question of which copy the Selection shows.
- **Its own collaborators, invitations and ownership transfer.** Rejected. See
  above: a second membership matrix, a second owner, and a lifecycle that
  outlives the works it references.
- **A third artwork status (`hidden`/`unlisted`).** Rejected. It would say "not
  on the Catalogue's page" a second time, differing from `draft` only in
  whether a Selection may take it — a decision made at add time by the person
  clicking. It also forces every surface that speaks the status vocabulary —
  import, the agent tools, the filter, the badges, every test — to learn a third
  word for a distinction the Selection already expresses.
- **Renaming Draft to Hidden.** Rejected. The word would be false exactly where
  the feature is used: a work a public Selection shows is not hidden. And the
  stored semantics are already Catalogue-relative ("`published` puts it in front
  of the catalogue's gate, `draft` keeps it inside").
- **One Selection across several Catalogues.** Rejected for now. It needs a rule
  for whose members curate and whose gates it escapes; a Selection is cut from
  exactly one Catalogue.
- **A fourth Catalogue Kind, or a flag on Catalogue.** Rejected already in
  [ADR-0010](0010-collector-artist-and-gallery-are-catalogue-kinds-not-account-roles.md):
  a Selection is a second dimension, not a fourth kind.

## Consequences

- **Schema.** Two additive tables plus their access machinery, in one migration
  that ships alone: `selections` (`catalogueId`, `name`, `description?`,
  `isPublic` defaulting **false**, `passwordHash?`, `deletedAt?`, timestamps)
  and `selection_works` (`selectionId`, `artworkId`, `position`). Grants and the
  unlock throttle get their own tables rather than a polymorphic subject on the
  Catalogue's, because a second subject on the existing tables would need a
  nullable column, a check that exactly one is set, and a rewrite of a table
  whose current shape is load-bearing
  ([ADR-0005](0005-a-password-is-a-second-condition-on-a-public-collection.md)).
  Nothing is destructive and nothing backfills.
- **Access.** A second set of verdicts beside the Catalogue's: readability from
  the Selection's own visibility and password, membership of the source
  Catalogue for the write verdict, and the source Catalogue's deletion taking
  its Selections' addresses with it. The Selection's unlock route, throttle and
  grant cookie are its own, named for the Selection, so the Catalogue's remain
  untouched.
- **Media.** The proxy is Catalogue-scoped today, so it would refuse a visitor a
  Draft's photos — the very thing a public Selection of Drafts exists to show.
  The public Selection read therefore tags its media URLs with the Selection's
  id, and the proxy admits a request that names a readable Selection containing
  that live work, the cookie grant included for a protected one. **A Draft in a
  public Selection renders with its images.** A work's photos are readable by
  whoever can read the Selection that shows it and by nobody else; a Private
  Selection, or a Protected one without its grant, still answers 404. Documents
  stay members-only: a Selection never makes a certificate public.
- **Vocabulary.** **Public**, **Private**, **Protected**, **Published**,
  **Draft**, **Deleted**, **Slug**, **Visitor**, **Artwork fields**, **Tier**
  and **Selection** are rewritten; **Selection PDF** is new. The manage view's
  checkbox state is disambiguated in the Selection entry, because "selection"
  already names it in code and in the toolbar.
- **The warning is a feature, not a line of copy.** Publishing a Selection whose
  Catalogue is not visitor-readable is the single moment this model's risk is
  taken, so it gets a confirmation naming the Drafts exposed, and a persistent
  note on the Selection while the state holds.
- **What a Selection cannot say.** `availability` — a market fact — is
  member-only on the wire by deliberate policy, and a Selection's readers are
  visitors. A fair Selection therefore cannot print "Sold" or "For sale"; making
  it possible is a separate decision about that fact's audience, not part of
  this one.
- **Deferred.** Selection tools on the agent surface, Selections across
  Catalogues, a per-Selection skin, a dashboard section for Selections,
  per-work captions inside a Selection, and any cap on how many Selections a
  Catalogue may hold.

The implementation contract is [the Selections spec](../specs/selections.md).
