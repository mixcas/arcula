# A password is a second condition on a public collection

**Status**: accepted

A collection was public or it was not. Some collections should be readable by
anyone the owner chooses to hand a link to, while nobody who merely happens on
the address may look. That is not a third visibility state: it is the **Public**
state with a second requirement — the collection is public _and_ the reader
holds the password. [ADR-0003](0003-the-collection-gates.md) made the collection
the only gate on a visitor; this decision leaves that gate exactly where it is
and adds a challenge in front of it. Nothing about membership
([ADR-0004](0004-collections-are-shared-by-membership.md)) changes: the owner
and collaborators never face the challenge, because membership is already the
strongest verdict.

The vocabulary is in [GLOSSARY.md](../GLOSSARY.md): **Protected**, **Access
grant**, **Public**, **Private**.

## Decision

**The password is a condition on Public, not a visibility state.**
`collections.isPublic` stays the one gate and the password never replaces it, so
the two can never disagree. A collection with a password is **Protected**; the
word describes a Public collection with a second requirement, never a state a
collection can be in on its own. Setting a password on a Private collection is
meaningless — the gate already refuses everyone — and the settings UI does not
offer it.

**Storage is a one-way hash and nothing is recoverable.**
`collections.passwordHash` is nullable text holding a `scrypt` hash with a
per-hash random salt and its parameters encoded in the string
(`scrypt$N$r$p$salt$hash`), so the cost can be raised later without a migration.
The plaintext is never stored, never stored decryptably, never logged and never
sent to a client — under any read, for any viewer, including the owner. There is
deliberately no support path that reads a password back; "recovery" is
**reset**, which is the same write as Change. This costs the product nothing,
because a member is never locked out by the password: membership bypasses it.

**The grant is a server-verified row, carried as a cookie.** `POST
/collections/:id/unlock` takes the password and answers with an `HttpOnly`,
`SameSite=Lax` cookie, or `403 invalid-password`. The cookie holds a 32-byte
random token whose only stored form is its SHA-256 hash, in
`collection_access_grants(collectionId, tokenHash, createdAt, expiresAt)` with a
twelve-hour TTL. Every read verifies the grant server-side, per request. It must
be a cookie rather than a header: the media proxy is loaded by `<img>` tags,
which cannot carry a custom header, and the protection covers the bytes.

**There is one cookie per collection, and the name is the scope.** The cookie is
`arcula_grant_{collectionId}` on `Path=/api/v1`. A cookie's `Path` is a prefix of
the request path and cannot express "this collection": `/api/v1/media` serves
every collection's bytes, so no prefix covers the reads and the proxy while
excluding anything else. The path is broad on purpose and the **name** is the
selector — a route knows its own collection id and reads only the cookie named
for it, so a cookie for another collection is never even read. Scoping by name
is what the narrower prefix was reaching for; scoping by path was never
available.

**The grant admits exactly what a visitor sees.** Published, live works and
nothing else: drafts stay a member's, documents stay a member's at every status,
and the visitor rule is otherwise untouched. The password buys entry through the
collection's gate; it does not make a reader a member.

**A password change revokes every outstanding grant** by deleting that
collection's grant rows inside the same transaction. There is no version column:
the grants are rows we own and can enumerate, so revocation is a delete. A
change and a first set are the same operation — one write path, one revocation —
and only the validation differs.

**The lock is visible and existence is not the secret.** A non-member opening a
Protected collection gets a distinct state that names the collection and offers
a password field; the collection is **excluded from the anonymous list**, which
filters on public-and-not-protected, exactly as it excludes a Private one. So
the protection covers the works rather than the collection's existence, and the
existence is disclosed only by a direct link. That is the deliberate contrast
with an invitation token, where the artefact _is_ the secret and every failure
answers one uniform `not-found`
([`invitations.ts`](../apps/api/src/invitations.ts)). Here a wrong password is
`403 invalid-password`: the reader already knows the collection exists, so a
uniform refusal would buy no secrecy and only cost the prompt the ability to say
"that is not it".

**A protected collection is not a browsable one.** The anonymous list excludes
it and no read announces it. The name of a Protected collection is disclosed
only to somebody who already has the link, and only so the lock screen can name
what is being unlocked.

**Brute force is throttled in Postgres.** The unlock route is the first endpoint
whose purpose is to be guessed at, and there is no limiter in the product.
A fixed ten-minute window of ten failed attempts per IP **per collection**,
counted in the database, answers `429` past it. Only failures count and a success
clears the counter, so a member who mistypes carries no debt; keying on the pair
rather than the IP alone keeps one collection's throttle from becoming a weapon
against another's visitors through a shared address. It is honest rather than
complete — the identity is an IP, which is shared behind a proxy and plentiful
to an attacker with many — and the residual weakness is recorded here rather
than hidden.

**The password's rule is a minimum length.** Eight characters, in a shared
schema so both sides enforce one rule, and no complexity requirement — the
product is a collector's, not a bank's, and a rule that makes people write the
password on the lid is a worse outcome than a short one.

**The settings form never shows a password.** The server tells the member read
one bit, `isPasswordProtected` (derived from `passwordHash IS NOT NULL` at the
serializer boundary, never the hash itself), and the form renders from it: no
password set means a Password and Confirm pair; set and not editing means the
plain statement that the current password stays in effect, with **Reset
password** and **Remove password**; set and editing means the field pair with a
**Cancel**. Private collections show no password control. Making a collection
public again does **not** clear the password, and making it private keeps the
hash — so a republished collection returns to Protected rather than silently
unprotected. Only **Remove password**, or overwriting it, clears it.

**The lock screen is app chrome, not a skin.** It renders in
`PublicCollectionPage` beside the canonical-URL rewrite, because the set of
skins is open-ended and every skin would otherwise have to implement it, and
because the lock is about the collection rather than its presentation. On
success the page re-runs the same load a public visitor uses, with the grant
cookie now set, so there is one path to ready.

## Considered Options

- **A third visibility state (public / private / protected).** Rejected. Public
  is defined as readable by a visitor, and a password is a second condition on
  that readability rather than a replacement for it. A third state lets
  `isPublic` and the password disagree — public-but-not-really — which is exactly
  the "two flags admitting a third case" problem ADR-0003 removed for artworks.
- **Protected collections are numbered among the private ones and answer a plain
  refusal.** Rejected. There would be no prompt, and the password could never be
  entered. It also needs the refusal to be indistinguishable from a private
  collection's, which the lock screen's existence contradicts.
- **Listing Protected collections in the anonymous list, flagged and
  truncated.** Rejected. It forks the serializer into a locked and an unlocked
  form of the same collection, invents a second row shape, and turns the index
  into a directory of every Protected collection's name and owner — for a
  product that has no discovery, no search and no ranking. A protected
  collection is shared as a link, not found in an index.
- **Hashing cheaply, as the invitation token does.** Rejected. The invitation
  token is 32 random bytes; the collection password is human-chosen and often
  reused from elsewhere, so a fast hash turns a database leak into an offline
  dictionary attack. Different artefact, different cost.
- **Encrypting the password so support can read it back.** Rejected. A hash is
  one-way by construction; a recoverable store is no defence against the leak
  hashing exists to stop, and it makes the key crown-jewels infrastructure and
  every backup a disclosure. Because membership bypasses the challenge, nothing
  the product promises actually needs it.
- **A second session system, or a stateless client-held password.** Rejected.
  A session to build, secure and expire duplicates Better Auth for one feature;
  sending the password on every read parks the plaintext in the client forever,
  where a URL, a referrer or a log can take it.
- **Carrying the grant in a header or a query parameter.** Rejected. `<img>`
  cannot send a custom header, which forfeits coverage of the bytes; a query
  parameter leaks the grant into referrers, logs and history.
- **Scoping the grant cookie with a narrow `Path`.** Rejected as impossible, not
  as undesirable: `Path` is a prefix of the request path, and no prefix covers
  `/collections/{id}`, `/collections/{id}/artworks` and `/api/v1/media` while
  excluding anything else — the proxy is one route for every collection. One
  cookie per collection, named for it, delivers the intended isolation at
  `Path=/api/v1`; do not narrow the path without first removing media from the
  protection.
- **A grant version column on `collections`.** Rejected. It earns its keep only
  when grants live somewhere they cannot be enumerated; ours are rows, so a
  password change deletes them and no bookkeeping column is needed.
- **A distinct `POST` to set and to change the password.** Rejected. Both mean
  "this is the password now, and outstanding grants are dead"; only the
  validation differs.
- **An unthrottled unlock route, deferred like the invitation limiter.**
  Rejected. The invitation gap is a mail-sending gap; an unthrottled unlock
  moves an offline dictionary attack online, against a human-chosen secret. A
  Postgres-backed counter is the cheap honest defence.
- **Making the lock screen a skin's job.** Rejected. Every skin would implement
  it, and it is not presentation.
- **Clearing the password when a collection goes private, or when it goes
  public.** Rejected. It makes republishing silently unprotect, and it discards
  the owner's secret on an unrelated action.
- **Owner-only password administration.** Rejected. A collaborator changes every
  setting (ADR-0004), and the password is a setting. The narrower role can
  arrive later without changing the fact.
- **A superadmin UI, or an application-level recovery path.** Deferred, and
  deliberately not designed: reset in the database is the recovery story, and
  the product needs no read-back.

## Consequences

- **Schema.** `collections` gains nullable `passwordHash`. A twelfth table,
  `collection_access_grants`, carries the grants, and a thirteenth,
  `collection_unlock_attempts`, the unlock throttle's counter. The design needs
  **two** releases, one per step, following the
  forward-only rule in [AGENTS.md](../AGENTS.md): `0005_…` adds the nullable
  column and the new tables, read by nothing; the feature code follows in the
  next. There is no second tightening migration — a collection without a
  password is the normal state, not a gap to backfill — so the contrast with
  `0003`/`0004` is the absence of a `NOT NULL` step, not a shorter sequence.
- **Deploy order.** `scripts/deploy.sh` deploys the Lambda before it migrates,
  so a release carrying both the column and the code that reads it would serve
  requests against a schema that is not there yet. The additions are
  additive-safe: the old code ignores them entirely.
- **Access.** `access.ts`'s verdicts gain the grant as a fact beside membership
  and the collection flags — still pure over rows a caller has loaded, with the
  grant's validity decided by a pure module beside `invitations.ts`. The read
  paths in `collections.ts`, `artworkRead.ts` and `media.ts` ask the extended
  verdict rather than a predicate of their own, so the single-authorization-layer
  property holds for the row and the bytes alike.
- **A wrong password discloses the collection exists.** Accepted and intended:
  the lock screen named it already, and the protection is over the works.
  Recorded here so the contrast with the invitation token is not later "fixed".
- **A collaborator can set the collection's password.** A consequence of
  membership being the write verdict, not an oversight.
- **The throttle is not a distributed limiter.** The counter is shared Postgres
  state keyed by IP and collection; it stops a naive script and does not stop a
  determined distributed one, because an IP is shared behind a proxy and cheap
  to multiply. Invitations and password resets still have no limiter at all.
- **Tests.** The hash/verify round trip and the extended pure verdict
  (`membership`, collection flags, grant validity) are tier-1: the whole security
  decision, testable with no server. `publicCollectionState` gains the locked
  branch as a pure fold. One API-integration pass drives the real stack — wrong
  password, right password, grant cookie, then a photo byte with and without the
  grant — because that is the one place the wire, the schema, the proxy and the
  cookie meet.
- **Not built here.** Account-level password management, a read-only role, a
  distributed rate limiter, and any application-level password recovery. The
  first and last are not wanted; the middle two are listed in
  `project-plan.md` under _What is not built_.
