# Arcula

The vocabulary of an art collection, as this product uses it. A term's meaning
here is the meaning it carries in an issue, a commit message and a test name.
Deployment, branch and process vocabulary is not here: it lives in
[AGENTS.md](AGENTS.md).

## Language

### People and the collection

**Collector**:
The person Arcula is built for: someone who owns the works and records them,
rather than a gallery or an institution that trades in them.
_Avoid_: User, customer

**Account**:
A collector's identity in Arcula — the email and password they sign in with.
An account owns collections and may collaborate on others.
_Avoid_: User, profile, tenant

**Owner**:
The account a collection belongs to. The only party who may invite, remove or
transfer, and the account the tier cap counts. An artwork's owner is its
collection's owner.
_Avoid_: Admin, author, member

**Collaborator**:
The account a collection has been shared with. A collaborator records and edits
artworks and changes the collection's settings, including whether it is public,
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
Moving a collection's owner to one of its collaborators. The previous owner
stays as a collaborator; only the owner may begin one.
_Avoid_: Handover, handoff, reassignment

**Access grant**:
What a reader holds after entering a protected collection's password. Scoped to
one collection, expiring, and verified on every request; it admits the reader to
the public view, not to the collection as a member.
_Avoid_: Session, unlock token, password token

**Collection**:
A set of artworks recorded together and named by their owner. The unit that is
shared with collaborators, tiered, and given a public page.
_Avoid_: Catalogue, gallery, album, library

**Shared**:
A collection whose owner has added collaborators. Distinct from **Public**,
which is readable by visitors; neither implies the other.
_Avoid_: Collaborative, team, group

**Artwork**:
One work in a collection: the thing a collector owns, with its title, artist
and the descriptive fields recorded against it.
_Avoid_: Piece, item, object, painting, entry

**Visitor**:
Anyone reading a collection or an artwork without an account, or without being
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
the account itself: an invitation to a collection, or the notice that an
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

### What is seen

**Public**:
Readable by a visitor. Only a collection carries this choice: it is the gate on
everything inside it. A work is never public on its own account.
_Avoid_: Published, shared, live

**Private**:
Readable by its owner and collaborators alone. To a visitor a private collection
is indistinguishable from one that does not exist.
_Avoid_: Hidden, unpublished, draft

**Protected**:
A public collection that also requires its password. A second condition on
public readability rather than a visibility of its own: the collection is still
public, and the owner and collaborators never face the challenge. A protected
collection is absent from the public list and reachable only by its link.
_Avoid_: Locked, password-protected, gated, restricted

**Lock screen**:
What a visitor to a protected collection is shown instead of the page until they
enter its password. App chrome, never a skin, because the lock belongs to the
collection rather than to how the collection is presented; the public views call
the state it puts them in `locked`, and a refused read is what reaches it.
_Avoid_: Password page, gate, interstitial

**Published**:
An artwork the owner or a collaborator has put in front of the collection's
gate. A published work is visible to a visitor exactly when its collection is
public.

**Draft**:
An artwork the owner or a collaborator keeps inside the collection but has not
put in front of the gate. The owner and collaborators see it everywhere; a
visitor never does, whatever the collection's own visibility. A draft counts as
part of the collection.
_Avoid_: Private (for a work), unpublished, hidden, WIP

**Deleted**:
Taken out of the collection as far as its owner and collaborators are
concerned: it leaves every live list, and it can be brought back. The record and
its media are not destroyed. The **Deleted** view is a collection's list of its
deleted works, most recently deleted first, where one or several are restored.
_Avoid_: Soft-deleted, removed, trashed, archived

**Slug**:
The readable name in a collection's or artwork's address, alongside the id.
It is cosmetic: only the id is ever looked up.
_Avoid_: Path, permalink

**Skin**:
The presentation a public collection is rendered in — its type, layout and
chrome.
_Avoid_: Theme, template, layout, design

**Skin options**:
A collection's choices within its skin — the settings the skin itself defines.
_Avoid_: Theme settings, preferences

**Collection PDF**:
A collection's published, live artworks exported as one document: a photo page
for each of an artwork's photos, up to three, and a grid for the artworks that
have none, ordered by artist then title. An export of the collection, never a
second presentation of it.
_Avoid_: Catalogue, catalogue PDF, portfolio

### Media

**Staged**:
An uploaded file that is held for an artwork still being edited, and that is
not yet part of the collection.
_Avoid_: Draft, pending, temporary

**Promoted**:
A staged file that has become part of the artwork it was uploaded for, at the
point the artwork was saved.
_Avoid_: Finalised, committed, moved

**Variant**:
One rendered size of an artwork photo or artwork document, at the size a page
actually displays it.
_Avoid_: Thumbnail, rendition, size

### Tiers

**Tier**:
The allowance an account is on — what it may create — and the unit the
collection cap is counted against. The cap counts the collections an account
owns, not those shared with it.
_Avoid_: Plan, subscription, level

**Free tier**:
The tier every account starts on: the one that allows a single owned collection.
_Avoid_: Basic plan, default plan
