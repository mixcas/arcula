# Arcula

The vocabulary of a catalogue of artworks, as this product uses it. A term's
meaning here is the meaning it carries in an issue, a commit message and a test
name. Deployment, branch and process vocabulary is not here: it lives in
[AGENTS.md](AGENTS.md).

## Language

### People and the Catalogue

**Collector**:
The audience a Collection serves: a person who owns the works and records them.
One of the three a Catalogue can belong to.
_Avoid_: User, customer

**Account**:
A person's identity in Arcula — the email and password they sign in with.
An account owns Catalogues and may collaborate on others.
_Avoid_: User, profile, tenant

**Catalogue**:
A named set of artworks, owned by an account, shared with collaborators, and
given a public page. The unit that is shared, tiered and presented; its **Kind**
says whose art it is and why it is held.
_Avoid_: Archive, gallery, album, library

**Kind**:
Which of the three a Catalogue is — Portfolio, Collection or Inventory. Fixed at
creation; it decides whose art the Catalogue holds and why, and it reinterprets
the Catalogue's name and description. Distinct from a Catalogue's
owner/collaborator relationship, which says what an account may do to it.
_Avoid_: Role, type, mode

**Portfolio**:
A Catalogue that is one artist's body of work. Its name is the artist's name and
its description is the artist's bio.
_Avoid_: Collection, oeuvre

**Collection**:
A Catalogue of works the account owns — the collector's Catalogue. Its name is
the collection's name and its description is the collection's description.
_Avoid_: Catalogue (when meaning the umbrella), holdings

**Inventory**:
A Catalogue of works the account represents for sale — the gallery's Catalogue.
Its name is the gallery's name and its description is about the gallery.
_Avoid_: Stock, booth, catalogue (when meaning the umbrella)

**Selection**:
A curated, ordered subset of one Catalogue's works, given its own address and
its own audience — Public, Private or Protected, independently of its
Catalogue's own. It references works rather than owning them and never edits
them, and it shows them as they are now: a work deleted in its Catalogue leaves
the Selection and returns on restore. It is not a kind, and it has no owner or
collaborators of its own: the source Catalogue's owner and collaborators curate
it, and its readers are visitors. A public Selection is reached by link only and
is advertised nowhere, its own Catalogue's page included. Not the artworks
manage view's checked works, which are a page state.
_Avoid_: Catalogue (this was its old name), subset, shortlist

**Reset request**:
An address asked by anyone, answered the same sentence whether or not an
account exists.
_Avoid_: Forgot password, reset email

**Reset form**:
Where a person sets a new password, reached only through the mailed link.
_Avoid_: Reset page, change-password form

**Owner**:
The account a Catalogue belongs to. The only party who may invite, remove or
transfer, and the account the tier cap counts. An artwork's owner is its
Catalogue's owner.
_Avoid_: Admin, author, member

**Collaborator**:
The account a Catalogue has been shared with. A collaborator records and edits
artworks and changes the Catalogue's settings, including whether it is public,
but may not invite, remove or transfer.
_Avoid_: Member, editor, guest

**Invitation**:
A pending offer to become a collaborator, addressed to an email, carried by a
single-use token, and expiring after seven days. Accepting one is how an invited
account becomes a collaborator.
_Avoid_: Invite, request, share link

**Invitee**:
The account an invitation is addressed to. Only its address is known when the
invitation is sent; accepting makes it a collaborator.
_Avoid_: Recipient, guest, invited user

**Ownership transfer**:
Moving a Catalogue's owner to one of its collaborators. The previous owner stays
as a collaborator; only the owner may begin one.
_Avoid_: Handover, handoff, reassignment

**Access grant**:
What a reader holds after entering a protected Catalogue's password. Scoped to
one Catalogue, expiring, and verified on every request; it admits the reader to
the public view, not to the Catalogue as a member.
_Avoid_: Session, unlock token, password token

**Catalogue search**:
A query against the recorded fields of the works in one Catalogue. Its free
text (`q`) is a member's; its structured filters — one or more values of a field,
text or enumerated — are answered within the reader's verdict, so a visitor
filters the published works they may already see. Values repeated within a field
are alternatives, and different fields are all required. It answers with the
live works that match; drafts are included for a member, deleted works never
are. The query lives in the page's address, so a search can be linked and
revisited.
_Avoid_: Filter, find, lookup

**Facet**:
The distinct values a filterable field takes across a Catalogue search's
filtered set, each with the number of works carrying it. Counted before paging,
so a facet agrees with the search it accompanies; a work with no value for the
field contributes no entry, and the caller cannot ask for "no value".
_Avoid_: Tag, category, bucket

**Shared**:
A Catalogue whose owner has added collaborators. Distinct from **Public**, which
is readable by visitors; neither implies the other.
_Avoid_: Collaborative, team, group

**Artwork**:
One work in a Catalogue: the thing it records, with its title, artist and the
descriptive fields recorded against it.
_Avoid_: Piece, item, object, painting, entry

**Visitor**:
Anyone reading a Catalogue, a Selection or an artwork without an account, or
without being an owner or a collaborator of the Catalogue it comes from. A
visitor sees only what is public.
_Avoid_: Guest, reader, viewer

### Mail

**Account mail**:
Mail about an account's own security or identity — a password reset, an address
verification — sent because the account asked for it or needs it, and never
suppressed by an email preference.
_Avoid_: Transactional mail, system mail, notification

**Relationship mail**:
A notice about an existing relationship between two parties rather than about
the account itself: an invitation to a Catalogue, or the notice that an
ownership transfer has happened.
_Avoid_: Marketing mail, transactional mail, notification

### The record

**Acquisition date**:
When the owner came by the work, as it was written down — "circa 1889",
"bought at auction, spring 2019". Text, never a parsed date, because the
precision a real acquisition has is the owner's to state.
_Avoid_: Purchase date, year

**Acquisition price**:
What the owner paid. Kept apart from the current value, because the two are
different facts and neither replaces the other.
_Avoid_: Cost, price

**Current value**:
What the owner believes the work is worth now. Distinct from the acquisition
price on purpose. The app labels it **Current price**; the stored key and the
import's column identity keep their old name, because a label does not earn a
migration.
_Avoid_: Value, price, valuation

**Provenance**:
The chain of hands a work has passed through, written as prose rather than
stored as fields.
_Avoid_: History, ownership

**Condition**:
The state of the physical work — a slow-moving fact about the object, not a
property of the record.
_Avoid_: Status, grade

**Medium**:
The material a work is made of, in the owner's own words — "Oil on canvas",
"Bronze", "Mixed media" — stored as the string that was typed. Distinct from
**Media**, which is the uploaded files.
_Avoid_: Media, technique, material

**Availability**:
A work's market state — available, reserved, sold or on consignment — the "for
sale" axis beside **Published** and **Draft**. It is one of a Catalogue's
**Artwork fields**: every Kind offers the same four states, and it is present
exactly when the Catalogue records it.
_Avoid_: Status, stock, for-sale

**Artwork fields**:
A Catalogue's choice of which of an Artwork's fields it records — thirteen of
them, starting from the defaults its Kind brings, with Title and Artist Name
always recorded. A field a Catalogue does not record is not asked for, is
refused on a save, is not matched by Catalogue search and is not printed in the
Catalogue PDF; a value already recorded is kept and returns when the field is
turned back on. A Selection has no choice of its own and prints its source
Catalogue's. Photos and Other Documents are not fields, and Published or Draft
is the work's stamp rather than one of its fields.
_Avoid_: Record fields, field visibility, schema, columns

**Artwork photo**:
A picture of the artwork itself, ordered with its siblings. The first one is
the work's primary thumbnail wherever it appears.
_Avoid_: Image, picture, attachment

**Artwork document**:
Something attached to an artwork that is a record of it rather than a picture
of it — a certificate, an invoice, a condition report, or an image of one.
_Avoid_: Attachment, file

**Other documents**:
The part of an artwork's record that holds its artwork documents.
_Avoid_: Attachments, files, documents

**Import**:
Works brought into a Catalogue in a batch — a member's CSV file, or the rows an
agent extracted from a document — and the act of bringing them. A member's CSV
import lands them Published; an agent's lands them as Drafts, because a
conversation is not a review. The status is the payload's, defaulting to
Published, so the member's workflow is unchanged.
_Avoid_: Upload, ingestion, batch, bulk add

**Read**:
Turning one artwork document — an invoice, a gallery label, a certificate, a
condition report — into text and values on the member's device, so the artwork
form arrives filled and the work lands as a Draft. One document to one artwork;
distinct from **Import**, which is batch work reviewed as a table.
_Avoid_: Extract, parse, scan, OCR, upload

**Map values**:
The step of a Read where the document's lines the machine could not place are
filed by hand: one row per line, each row offering the fields the Catalogue
records. Distinct from **Map columns**, which files a CSV's columns.
_Avoid_: Mapping table, mapping step

### What is seen

**Public**:
Readable by a visitor. A Catalogue and a Selection each carry this choice, and
each is the gate on what it holds, on its own terms: a work is never public on
its own account, and it is public when a public Catalogue lists it or a public
Selection includes it.
_Avoid_: Published, shared, live

**Private**:
Readable by the owner and collaborators of its Catalogue — for a Selection, of
the Catalogue it is cut from — and by no visitor. To a visitor a private
Catalogue or Selection is indistinguishable from one that does not exist.
_Avoid_: Hidden, unpublished, draft

**Protected**:
A public Catalogue or Selection that also requires its password. A second
condition on public readability rather than a visibility of its own: it is still
public, and the members who curate it never face the challenge. A protected one
is absent from the public list and reachable only by its link.
_Avoid_: Locked, password-protected, gated, restricted

**Lock screen**:
What a visitor to a protected Catalogue or Selection is shown instead of the
page until they enter its password. App chrome, never a skin, because the lock
belongs to the thing being read rather than to how it is presented; the public
views call the state it puts them in `locked`, and a refused read is what
reaches it.
_Avoid_: Password page, gate, interstitial

**Published**:
An artwork the owner or a collaborator has put on its Catalogue's own page. A
published work is visible there exactly when its Catalogue is public. A
Selection does not consult this: a work can be in front of a Selection's gate
while its Catalogue has not listed it, and being listed does not put it in any
Selection.
_Avoid_: Public (for a work), live

**Draft**:
An artwork the owner or a collaborator keeps off its Catalogue's own page. The
members see it everywhere; a visitor never sees it on the Catalogue's page or in
the Catalogue PDF, though a Selection that includes it does show it — the only
way a visitor meets a draft.
_Avoid_: Private (for a work), unpublished, hidden, WIP

**Deleted**:
Taken out of use without its record being destroyed. An artwork is Deleted when
a member stamps it: it leaves every live list and keeps its bytes, and any
member restores it from the Catalogue's **Deleted** view, most recently deleted
first. A Catalogue is Deleted when its owner deletes it: it leaves every list and
every collaborator's dashboard, and every address that named it answers
not-found, for everyone including the owner; only an operator's database update
restores it — the app offers no restore for a Catalogue. A Selection is Deleted
when a member of its source Catalogue deletes it: its address answers not-found
for everyone, and an operator's update is again the only restore; deleting the
Catalogue takes its Selections with it. Every sense keeps the record; for a
Catalogue that includes its works and their media. The difference is who may
bring it back and how far the deletion reaches.
_Avoid_: Soft-deleted, removed, trashed, archived

**Slug**:
The readable name in a Catalogue's, a Selection's or an artwork's address,
alongside the id. It is cosmetic: only the id is ever looked up, and a rename
changes the address.
The id is the identity: short, opaque and hyphen-free — a route recovers it by
cutting at the last hyphen, so a hyphen inside it would break the address. Ids
minted before the short form are longer and permanent; both lengths live in the
tree on purpose
([ADR-0007](docs/adr/0007-ids-are-ten-base62-characters.md)).
_Avoid_: Path, permalink

**Skin**:
The presentation a public Catalogue or Selection is rendered in — its type,
layout and chrome.
_Avoid_: Theme, template, layout, design

**Skin options**:
A Catalogue's choices within its skin — the settings the skin itself defines. A
Selection has none of its own: it inherits its source Catalogue's.
_Avoid_: Theme settings, preferences

**Artworks manage view**:
How an owner or a collaborator browses a Catalogue's artworks on its manage
page: as a **Table**, for scanning the recorded fields, or as a **Grid** of
photo cards, for recognising the works by their images. A manage-page
presentation only — never how a visitor sees the Catalogue, which is a skin's
business.
_Avoid_: Layout, list mode, display mode

**Catalogue PDF**:
A Catalogue's published, live artworks exported as one document: a photo page
for each of an artwork's photos, up to three, and a grid for the artworks that
have none, ordered by artist then title. An export of the Catalogue, never a
second presentation of it.
_Avoid_: Catalogue, portfolio

**Selection PDF**:
A Selection's works exported as one document, in the order its curator set, with
its Catalogue's Artwork fields and its Drafts included. An export of the
Selection, never a second presentation of it.
_Avoid_: Catalogue PDF, shortlist, fair catalogue

### Media

**Staged**:
An uploaded file that is held for an artwork still being edited, and that is
not yet part of the Catalogue.
_Avoid_: Draft, pending, temporary

**Promoted**:
A staged file that has become part of the artwork it was uploaded for, at the
point the artwork was saved.
_Avoid_: Finalised, committed, moved

**Variant**:
One rendered size of an artwork photo or artwork document, at the size a page
actually displays it.
_Avoid_: Thumbnail, rendition, size

### Agents

**Agent**:
An AI client acting for an account through a Connection, with the account's
permissions and never more. The client is the agent; the Connection is its
standing access.
_Avoid_: Bot, assistant

**Connection**:
An agent's standing access to one account: the person's approval of one MCP
client, named for that client, listed in the account profile with when it
connected and last acted, and revocable on its own. One per account and client,
so two installations of the same client share one Connection and one Revoke; a
duplicate approval collapses to the newest. Never the browser session, and
never a way into it.
_Avoid_: Token, API key, integration, app, plugin

### Tiers

**Tier**:
The allowance an account is on — what it may create — and the unit the
Catalogue cap is counted against. The cap counts the Catalogues an account
owns, not those shared with it; a Selection is neither counted nor capped.
_Avoid_: Plan, subscription, level

**Free tier**:
The tier every account starts on: the one that allows ten owned Catalogues.
_Avoid_: Basic plan, default plan
