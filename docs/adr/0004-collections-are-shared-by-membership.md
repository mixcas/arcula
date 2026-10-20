# Collections are shared by membership

**Status**: accepted

A collection used to have one account that could read or change it:
`collections.userId`, compared against the session on every route. Sharing a
collection with another person therefore meant handing over the account or
copying the data. A collection is now shared by invitation, and the
owner-or-collaborator question is answered by a membership row rather than by
`userId` alone. The visitor rule is untouched: the collection is still the only
gate, and [ADR-0003](0003-the-collection-gates.md) still decides what a visitor
sees.

## Decision

**Access is membership.** `collections.userId` remains the one owner fact.
`collection_collaborators(collectionId, userId, createdAt)` holds everyone else
with access; the owner is not duplicated there. `access.ts` answers the owner
side from membership: the owner and every collaborator see the whole collection,
drafts and soft-deleted works included. Every write route checks membership
rather than `row.userId === session.user.id`. Documents stop being owner-only
and become readable by the owner and collaborators at every status; a visitor
still never reads one.

**Ownership is not the media namespace.** `collections.mediaNamespaceId` is
fixed when the collection is created (the schema release backfills existing
rows from `userId`) and is the second segment of every final object key
forever. A transfer updates
`collections.userId` and mirrors it onto `artworks.userId`, and does not move an
object: existing URLs keep working. `artworks.userId` is a mirror of the
collection owner, not an authorization fact and not a source of URLs. No
per-work creator is recorded.

**Staging stays per uploader.** A staged object is keyed by the account that
uploaded it; final objects are keyed by the collection's namespace. A
collaborator reads only their own staged objects, and the maintenance sweep
lists only the caller's staging prefix, so one person's sweep cannot destroy
another's unsaved upload. Removing a collaborator deletes their staging prefix
for that collection, best effort, with the seven-day staging lifecycle as the
backstop.

**Invitations are email and a hashed token.** `collection_invitations` carries
`collectionId`, the invited `email` (trimmed and lowercased), `invitedByUserId`,
`tokenHash`, `status` (`pending`, `accepted`, `declined`, `revoked`),
`createdAt`, `expiresAt`, and `resolvedAt`. The raw token exists only in the
mail; the row stores its hash. An invitation is valid for seven days and is
single-use. There is one **pending** invitation per
`(collectionId, lower(email))`; resending rotates the token and expiry on that
row. Accepted, declined and revoked rows are kept as history. A new invitation
after a decline or revocation is a fresh row.

**Only the invited inbox can accept.** Acceptance requires a signed-in account
whose email matches the invitation and the token from the mail. Email matching
alone is not enough: verification is off, so anyone could sign up with an
address they do not own. An invitation is never auto-accepted for an account
that already exists. The in-app list can show a pending invitation and decline
it, but cannot accept it; that would reintroduce the same hole. The invite page
shows the collection, the inviter and the invited email before sign-in, and a
signed-in mismatch offers a switch-account action. Invalid, expired, revoked,
consumed and unknown tokens all answer one `not-found`.

**The owner administers access.** Only the owner invites, resends, revokes,
removes and transfers; a collaborator sees who else has access but not the
pending invitations. A collaborator may edit every artwork, import, upload, and
change every setting — including public/private — and may leave. The owner
cannot leave without transferring, because collections are never deleted.
Removing a collaborator or leaving takes effect immediately; saved works stay,
unsaved uploads do not.

**Transfer is immediate and leaves the previous owner in place.** The recipient
must already be a collaborator. The transfer updates `collections.userId`, swaps
the two membership rows (recipient out, previous owner in), and mirrors
`artworks.userId` in one transaction; it then emails the new owner. The previous
owner stays a collaborator. It is never refused for the recipient's tier. A
transfer the recipient must accept is not built.

**The cap counts owned collections.** A collection shared with an account does
not consume that account's tier; receiving a transfer may take an account over
its cap and is allowed. The cap gates creation, not ownership.

**One list, with a role.** `GET /collections` returns owned and shared
collections together, each with `role` (`owner` or `collaborator`) and, on a
shared row, `ownerName`. The access card reads `GET /collections/:id/access`;
the invitee's pending list reads `GET /me/invitations`. The envelope gains
`conflict` (409) for state conflicts — already a collaborator, an invitation
already pending, a transfer target that is not one, an owner trying to leave, an
invitation no longer pending. A malformed email stays `validation` (400); a collaborator attempting
an owner-only access change is `forbidden` (403); a wrong-account acceptance is
`forbidden` with the invited email.

**Two mails, best effort.** Only the invitation and the ownership-transfer
notice are sent. The invitation row is written before the mail is attempted; a
provider failure answers `emailSent: false` and the owner can resend. Resend has
a 60-second cooldown. No rate limiter ships in v1.

## Considered Options

- **A read-only viewer role now.** Rejected. The requirement is one collaborator
  who can edit and change settings; a viewer doubles the permission matrix and
  every UI gate for a role nobody has asked for. A `role` column can arrive
  later without changing the owner fact.
- **One membership table with a role, owner included.** Rejected. It duplicates
  the owner fact — `collections.userId` and a role row — and every query has to
  agree which one is authoritative; a transfer becomes an update in two places.
  The owner stays the column; collaborators are the rows.
- **Auto-add an account that already has the email.** Rejected. It removes the
  consent step the product is built around, and it makes an invitation and a
  membership the same event. Every invitation stays pending until accepted.
- **Acceptance by matching email alone.** Rejected. Email verification is off, so
  anyone could sign up with an address they do not own and take the invitation.
  The token is the proof of inbox control.
- **In-app accept, gated on `emailVerified`.** Rejected. Verification is off and
  nobody is prompted to turn it on; this would hide the accept path behind a
  setting. The dashboard lists and declines; the mail accepts.
- **Copying every object on transfer.** Rejected. It is a multi-object
  migration that can partially fail mid-transfer, and the rows would be correct
  while the bytes were half-moved. The namespace is fixed instead.
- **Keying final objects by `collectionId`, or leaving `userId` in the key.**
  Rejected. `collectionId` is already a segment, so keying by it is redundant,
  and leaving `userId` would either move every object on transfer or leave the
  key naming an account that no longer owns the collection. A fixed
  `mediaNamespaceId` keeps every existing key and survives a transfer.
- **Collection-wide staging.** Rejected. An in-flight upload has no row yet, so
  a sweep that deletes staged objects without rows can delete another
  collaborator's unsaved work. Per-uploader staging keeps the blast radius to
  the caller's own space.
- **Owner-only public/private.** Rejected. "Change settings just like the
  owner" includes the gate; a collaborator who cannot publish still cannot do
  the job they were invited to do.
- **Transferring to an arbitrary email.** Rejected. It would create a
  collaborator and an owner in one step, bypassing the invitation and its
  consent. The recipient must already be a collaborator.
- **Showing pending invitations to collaborators.** Rejected. The invitation
  list is an owner administrative view — addresses, expiry and the token
  lifecycle. Collaborators see the people with access.
- **A separate `/collections/shared` endpoint.** Rejected. It splits one list
  into two client paths and makes the dashboard merge them. One list with a
  `role` is the same data with the distinction in the row.
- **The previous owner loses access on transfer.** Rejected. An immediate
  disappearance from a collection they were working in is a worse surprise than
  a collaborator row. They can leave deliberately.
- **Deleting an invitation when it resolves.** Rejected. A decline and a
  never-sent invitation would be indistinguishable, and the owner would lose the
  record of who was asked. Rows carry status; expiry is computed.
- **A transfer the recipient must accept.** Deferred, not rejected. It prevents
  an unwanted ownership, but it introduces a pending-transfer state, a second
  notification and a timeout. The product starts with immediate transfer and a
  notice.
- **Dropping `artworks.userId` now.** Deferred. It is a mirror with no
  authorization job after this change, but dropping it touches the wire type,
  the serializer and the indexes. Keeping it in step is cheaper than removing it
  in the same release.
- **An invitation rate limiter now.** Deferred. Better Auth's reset path sends
  mail to arbitrary addresses unthrottled, so an invite-only limiter is
  incomplete; both need one limiter. Resend has a cooldown, and the gap is in
  _What is not built_.
- **Failing the invitation when the mail fails.** Rejected. The row is the
  durable fact; a provider outage should not make the owner re-enter the address
  or lose the invitation. `emailSent: false` lets the UI offer a resend.

## Consequences

- **Schema.** Eleven tables: the four Better Auth tables, `collections`,
  `artworks`, the two artwork child tables, the variants table, and the two new
  sharing tables. `collections` gains `mediaNamespaceId`. The design needs
  **two** migrations, one per release: `0003_shared_collections` creates the
  two tables, adds `mediaNamespaceId` nullable and backfills existing rows from
  `userId`; `0004_media_namespace_not_null` backfills the rows the old code
  creates in between and sets the column `NOT NULL`. A single migration that
  sets `NOT NULL` would break the old code's collection inserts during the
  schema-first release. That is a documented exception to "generated plus an
  appended backfill"; nothing else is hand-written.
- **Deploy order.** `scripts/deploy.sh` deploys the Lambda before it migrates, so
  the schema change ships **alone** in one release and the code that needs it in
  the next. The new tables and the nullable column are additive-safe: the old
  code ignores them. The feature code reads `mediaNamespaceId ?? userId` until
  `0004` has run, so a collection created by the old code in the gap still
  resolves its existing media; a transfer in that gap persists the fallback
  before it changes the owner. A release that ships both would serve requests
  against tables that do not exist yet.
- **Access.** `access.ts`'s verdicts take membership facts; `authorize.ts` loads
  the membership row with the collection and every write path uses it.
  `artworkRead.ts`'s owner list stops filtering on `artworks.userId`, and the
  media proxy's staging branch admits the uploader rather than the collection
  owner. `serialize.ts` builds final URLs from `mediaNamespaceId`, and the
  collection's list gains `role`/`ownerName`.
- **Tests.** The pure membership verdict, the invitation state transitions
  (accept vs revoke, expiry, re-invite), the transfer invariant (the owner and
  the mirror move, the namespace does not), and the sweep/staging boundary are
  tier-1 or API-integration tests. The migrations' backfills are asserted by
  the schema suite.
- **Not built here.** A read-only role, per-work attribution or audit trail,
  acceptance of a transfer, invitation rate limiting, a collaborator cap, and
  account deletion. They are listed in `project-plan.md` under _What is not
  built_.
