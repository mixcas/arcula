# A collection is deleted by its owner, and its rows stay

**Status**: accepted

A collection used to be permanent. Once created, it stayed in every list and on
every address, and it counted against its owner's tier cap even after the owner
had stopped using it. At the free tier — one owned collection — that was a
permanent lockout: an account whose one collection was unwanted could never
create another, and the only way out was a hand-written database edit.

The owner can now delete a collection from the bottom of the Collection Settings
Data tab. The card names the collection and states the consequence — the
collection, its works and their photos and documents leave Arcula, and the app
cannot undo it — and the red button enables only once the owner has typed the
collection's exact name (trimmed, case-sensitive). Nothing opens a dialog
afterwards; the typed name is the confirmation. Nothing else in the app deletes a
collection.

Deleting is not leaving. A collaborator's leave keeps the collection alive, and
the owner still cannot leave without transferring
([ADR-0004](0004-collections-are-shared-by-membership.md)); a deletion ends the
collection for everyone and only the owner may perform it, so it is neither
leaving nor an alternative to transfer.

## Decision

**Owner-only, one route.** `DELETE /api/v1/collections/{id}` requires a session.
The owner is established by `requireOwnerCollection`, so a collaborator is
refused `forbidden` (403) and a request with no session `unauthorized` (401).
Success is `204` with no body. A collection that is absent or already deleted is
`not-found` (404): a second delete is not an error the user can act on, and the
client treats that answer as success.

**The stamp is the deletion.** `collections.deletedAt` is a nullable timestamp;
null is live, a value is deleted. It is nullable with no default and no backfill,
because a collection without a stamp is the normal state, and the migration —
`0007_collection_deletion_stamp`, a single additive `ADD COLUMN` — ships alone,
ahead of the code that reads it, per the forward-only rule. There is no index:
the lists and the cap count already narrow on the owner column, and deleted rows
are rare.

**Nothing cascades.** The stamp is the whole record of deletion. Artwork rows,
their photo and document rows, every media object, the collaborator rows and the
unlock-attempt rows stay exactly as they were, including each work's own
`deletedAt`. That is what makes the operator's restore one column, and it is the
deliberate difference from deleting a collection's artworks, which a member can
undo from the app.

**One transaction.** Stamping `deletedAt` and `updatedAt`, withdrawing the
collection's pending invitations (`status` → `revoked`, `resolvedAt` → now) and
deleting the collection's Access grant rows happen together, so no request can
observe a deleted collection that still holds a live offer or a valid grant.
Invitations already resolved — accepted, declined, revoked — are history and are
left alone. The stamp's own update is guarded on `deletedAt IS NULL`, so two
racing deletes produce one stamp and the loser answers not-found rather than
moving the timestamp twice.

**A deleted collection is not found on every path, for every viewer.** The
shared loader in `authorize.ts` refuses a stamped row, so every consumer of it
answers not-found with no per-route change: the settings read and write, the
artwork list and the single-work read (including the Deleted view), the media
proxy, the collection PDF, the invitation preview and acceptance, and the unlock
route. The owner gets the same answer as a stranger, so a deleted collection is
indistinguishable from one that never existed. The four raw queries that bypass
the loader filter the stamp themselves: the anonymous public list, the signed-in
list of owned and shared collections, the tier-cap count, and the invitee's
inbox join. The inbox is additionally kept honest by the withdrawal; its filter
is the defence for any invitation row written by a path that did not go through
the owner check.

**The cap counts live collections.** The tier cap counts owned collections that
are not deleted, so a deletion frees its slot immediately; an account at the free
tier's cap can delete its one collection and create another. The dashboard's
counter follows automatically because it reads the same list.

**No mail.** Deletion sends nothing, to collaborators or anyone else. A deletion
an operator can restore should not be announced as permanent, and the product's
two relationship mails — the invitation and the ownership-transfer notice — stay
the whole set. This is an accepted gap: a collaborator learns by the collection
disappearing from their dashboard.

**The operator's restore.** An operator restores a collection by clearing the
stamp by id and moving the record's timestamp:

```sql
UPDATE collections
   SET "deletedAt" = NULL, "updatedAt" = now()
 WHERE id = '<collection id>';
```

The works, their media and their own deletion states come back untouched, and a
surviving collaborator row resumes working. The restore does **not** un-withdraw
invitations and does **not** re-mint Access grants: an invitee must be invited
again, and a password holder must answer the lock screen again. Re-inviting is
the way back for people. There is no script and no in-app control — the act stays
deliberate and rare, and the app promises no undo.

**Two accepted costs.** Storage is never reclaimed: a restore needs the objects,
so a deletion deletes none, and a deleted collection's media library stays in the
bucket indefinitely. And not-found is API-deep, not byte-deep: final public photo
responses are cacheable for an hour, so a reader who already fetched a public
collection's media can keep seeing those bytes from a browser or shared cache
until that hour lapses. That is a property of any public URL, recorded rather
than fought.

## Considered Options

- **A hard delete with a cascade.** Rejected. It is irreversible: one mistaken
  transaction destroys the works and their media, and no restore exists. The
  media objects cannot be deleted in the same transaction as the rows, so a
  partial failure would leave bytes orphaned from rows or rows pointing at
  missing bytes. The product's word for this act is "leave Arcula", not "destroy
  the bytes", and the owner's own works should survive a slip.
- **Purging storage on delete.** Rejected. A restore needs the objects, so a
  purge and an operator restore cannot both exist. The storage bill is the
  accepted price of the restore, recorded above; an S3 delete that rolls back
  with the row is not available.
- **An in-app restore, a trash view or an undo.** Rejected. It adds a second
  lifecycle surface — a list, a retention policy, a restore path through every
  route and every UI — for a recovery the operator's one-column update already
  covers. The app states that deletion cannot be undone, and that is the truth
  it can keep.
- **Mailing collaborators about the deletion.** Rejected. The deletion is
  restorable, so a mail announcing it as final would claim more than the data
  supports; the product keeps the two relationship mails it owns, and a
  collaborator learns by the collection leaving their dashboard. The gap is
  accepted rather than hidden.
- **A delete entry point anywhere but the Data tab** — the dashboard row, the
  collection page, a bulk action. Rejected. The destructive act is reachable only
  where its consequence is stated, and the typed collection name is the
  confirmation there; a second entry point would offer the act without the
  sentence beside it.
- **Refusing stamped rows in each route.** Rejected. Every route would need its
  own check, and a new read path could silently resurrect a deleted collection.
  The shared loader is the one chokepoint, and the four queries that bypass it
  carry an explicit filter that a new raw list query is expected to copy.
- **Filtering deleted rows out of the lists only.** Rejected. Every address that
  named the collection must answer not-found for everyone, the owner included; a
  list filter alone would leave direct links, media keys, PDFs and invitation
  tokens live.

## Consequences

- **Schema.** `collections` gains a nullable `deletedAt` timestamp, with no
  default, no backfill and no new index; the table count is unchanged. The
  migration is additive and ships in its own release, ahead of the code release,
  so the old code serves exactly as before in the gap.
- **Access.** `authorize.ts`'s `loadCollection` gains `deletedAt IS NULL`; every
  authorization, read and write path that already uses it inherits the refusal.
  The anonymous and signed-in list queries, the cap count and the invitee's inbox
  join filter the stamp explicitly.
- **Wire and API.** A deleted collection never serializes, so no `deletedAt`
  field appears in the collection document and no shared schema changes. The new
  route adds `204`, `401`, `403` and `404` answers that the envelope already
  models; no new error code ships. The client treats a delete `404` as success,
  so a collection deleted in another tab is not a dead end.
- **Tests.** The API integration suite pins the behaviour at the wire and the
  rows: the owner's `204`, the collaborator's `403`, the second delete's `404`,
  absence from both lists and the invitee's inbox, not-found on every address
  for owner, collaborator and visitor, the freed tier slot, the withdrawn
  invitation and its dead link, the removed grant rows, and the surviving
  collaborator, artwork and object state. The settings-page component suite pins
  the owner-only card and the typed-name confirmation.
- **Design record.** [ADR-0004](0004-collections-are-shared-by-membership.md)'s
  clause that the owner cannot leave without transferring no longer rests on
  collections being permanent, and carries an amendment pointing here. The
  glossary's **Deleted** gains the collection sense beside the artwork's, and the
  schema narrative in `project-plan.md` describes the column.
