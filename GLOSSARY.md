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
A curated subset of a Catalogue's works, published on its own address with its
own audience. It references works rather than owning them, and it is not a kind:
any kind can be selected from.
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
A member's query against the recorded fields of the works in one Catalogue. It
answers with the live works that match; drafts are included, deleted works never
are. The query lives in the page's address, so a search can be linked and
revisited.
_Avoid_: Filter, find, lookup

**Shared**:
A Catalogue whose owner has added collaborators. Distinct from **Public**, which
is readable by visitors; neither implies the other.
_Avoid_: Collaborative, team, group

**Artwork**:
One work in a Catalogue: the thing it records, with its title, artist and the
descriptive fields recorded against it.
_Avoid_: Piece, item, object, painting, entry

**Visitor**:
Anyone reading a Catalogue or an artwork without an account, or without being
its owner or a collaborator. A visitor sees only what is public.
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
price on purpose.
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
A work's market state on a Portfolio or an Inventory — whether it is for sale,
reserved or sold — the "for sale" axis beside **Published** and **Draft**, which
are about visibility. A Collection carries no availability.
_Avoid_: Status, stock, for-sale

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
A file a member brings into a Catalogue and the works drawn from it. A member's
CSV import lands them Published; an agent's lands them as Drafts, because a
conversation is not a review.
_Avoid_: Upload, ingestion, batch, bulk add

### What is seen

**Public**:
Readable by a visitor. Only a Catalogue carries this choice: it is the gate on
everything inside it. A work is never public on its own account.
_Avoid_: Published, shared, live

**Private**:
Readable by its owner and collaborators alone. To a visitor a private Catalogue
is indistinguishable from one that does not exist.
_Avoid_: Hidden, unpublished, draft

**Protected**:
A public Catalogue that also requires its password. A second condition on public
readability rather than a visibility of its own: the Catalogue is still public,
and the owner and collaborators never face the challenge. A protected Catalogue
is absent from the public list and reachable only by its link.
_Avoid_: Locked, password-protected, gated, restricted

**Lock screen**:
What a visitor to a protected Catalogue is shown instead of the page until they
enter its password. App chrome, never a skin, because the lock belongs to the
Catalogue rather than to how the Catalogue is presented; the public views call
the state it puts them in `locked`, and a refused read is what reaches it.
_Avoid_: Password page, gate, interstitial

**Published**:
An artwork the owner or a collaborator has put in front of the Catalogue's gate.
A published work is visible to a visitor exactly when its Catalogue is public.

**Draft**:
An artwork the owner or a collaborator keeps inside the Catalogue but has not
put in front of the gate. The owner and collaborators see it everywhere; a
visitor never does, whatever the Catalogue's own visibility. A draft counts as
part of the Catalogue.
_Avoid_: Private (for a work), unpublished, hidden, WIP

**Deleted**:
Taken out of use without its record being destroyed. An artwork is Deleted when
a member stamps it: it leaves every live list and keeps its bytes, and any
member restores it from the Catalogue's **Deleted** view, most recently deleted
first. A Catalogue is Deleted when its owner deletes it: it leaves every list and
every collaborator's dashboard, and every address that named it answers
not-found, for everyone including the owner; only an operator's database update
restores it — the app offers no restore for a Catalogue. Both senses keep the
record, its works and their media; the difference is who may bring it back.
_Avoid_: Soft-deleted, removed, trashed, archived

**Slug**:
The readable name in a Catalogue's or artwork's address, alongside the id.
It is cosmetic: only the id is ever looked up, and a rename changes the address.
The id is the identity: short, opaque and hyphen-free — a route recovers it by
cutting at the last hyphen, so a hyphen inside it would break the address. Ids
minted before the short form are longer and permanent; both lengths live in the
tree on purpose
([ADR-0007](docs/adr/0007-ids-are-ten-base62-characters.md)).
_Avoid_: Path, permalink

**Skin**:
The presentation a public Catalogue is rendered in — its type, layout and
chrome.
_Avoid_: Theme, template, layout, design

**Skin options**:
A Catalogue's choices within its skin — the settings the skin itself defines.
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

**Connection**:
An agent's standing access to one account, approved by the person, named for the
client that made it, listed and revocable on its own. Never the browser session,
and never a way into it.
_Avoid_: Token, API key, integration, app, plugin

### Tiers

**Tier**:
The allowance an account is on — what it may create — and the unit the
Catalogue cap is counted against. The cap counts the Catalogues an account
owns, not those shared with it.
_Avoid_: Plan, subscription, level

**Free tier**:
The tier every account starts on: the one that allows ten owned Catalogues.
_Avoid_: Basic plan, default plan
