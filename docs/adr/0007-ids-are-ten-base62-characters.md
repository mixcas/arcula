# Ids are ten base62 characters

**Status**: accepted

A collection's or artwork's address is `{urlizedName}-{id}`: the public page,
its PDF export and the manage page all end in the id, and the id is a UUID with
its hyphens removed — 32 lowercase hex characters. The readable name is a small
fraction of the address and the id is most of it, so a link pasted into a mail,
a card or a chat reads as a wall of hex. Nobody reads a UUID; its length buys
nothing a reader can see.

Two things make the length more than cosmetics. A **Protected** collection is
deliberately absent from the public list and reachable only by the link its
owner handed out, so the id's entropy is a mild second layer beneath the
password ([ADR-0005](0005-a-password-is-a-second-condition-on-a-public-collection.md)).
And the id is a segment of every final media object key, so its shape is a
storage fact, not only an addressing one.

## Decision

**New ids are ten base62 characters.** Digits, then uppercase, then lowercase:
59.5 bits, far beyond what a password-gated link needs to resist guessing, while
removing two thirds of the id's mass from every URL. The address becomes
`/collection/flores-solares-aB3d9Kx2Qp`.

**One mint, in the shared contract.** `packages/shared/src/ids.ts` exports
`ID_LENGTH` (ten), `ID_ALPHABET`, `MINTED_ID_SHAPE_RE` and `mintId`, and both
halves of the product call it: the API for collections, CSV-imported artworks,
invitations and media namespaces; the browser for the artwork id the Add page
supplies before its staged uploads. The product's length and alphabet are stated
once, where both runtimes read them, instead of repeated as a literal on each
side.

**Sampling is unbiased.** Bytes come from the platform's cryptographically
secure source and a byte at or above the largest multiple of 62 below 256 (248)
is redrawn. `256 % 62` is 8, so a modulo would favour the first eight symbols by
one draw in 32 — entropy the id advertises but does not deliver. The module
narrows the platform source once, because the shared package binds no runtime
types and must run in Bun, Node and the browser, and it throws rather than
falling back when no secure source exists.

**The validator accepts exactly what the mint emits, plus what already exists.**
`MINTED_ID_RE` tightens from `^[A-Za-z0-9_-]{1,64}$` to
`^[A-Za-z0-9]{1,64}$`. The hyphen goes because a hyphen inside an id puts the
route parser's cut — it recovers the id by cutting at the last hyphen — inside
the id; the underscore goes because nothing mints it. The rule the parser depends
on is now a property of the validator rather than a comment beside the
generator. A legacy 32-character hex id still passes, which is why doing nothing
about existing rows needs no compatibility branch.

**Case is significant and accepted.** There is no case folding on read.
Normalising would reconcile a case-flipped link against a case-sensitive primary
key, turning a copy-paste failure into a possible uniqueness bug. Ids are copied
out of links the product wrote, never retyped, so a flipped capital is a clean
not-found rather than another collection.

**Existing ids are never migrated.** A collection, artwork, invitation or media
namespace created before this change keeps its 32-character id. The tree holds
both lengths indefinitely.

**Out of scope, deliberately.** The user id stays Better Auth's — it never
appears in an address. Upload entry ids keep their hyphen-free UUID shape: they
are internal object-key segments that never reach a URL and nothing looks them
up by shape. The slug stays cosmetic and unpersisted, so a rename still changes
the address.

## Consequences

- **A new row's address is shorter; an old row's address does not change.** The
  slug is still cosmetic, so the URL remains readable regardless of which id
  length follows it.
- **Two id lengths in one database is the intended state, not a bug.** A reader
  who finds a ten-character id beside a 32-character one is looking at when the
  row was created. This record exists so that conclusion is available.
- **No object moves and no media key changes.** Collections created now use the
  short id as their media namespace; old collections keep the long one. Both are
  just key segments.
- **A mistyped or truncated link fails cleanly.** Any id-shaped string that does
  not name a row is a not-found; it cannot resolve to another collection.
- **The id's entropy is a cost floor, never a security boundary.** A Protected
  collection's gate is its password; ten characters only make guessing a link
  more expensive.

## Alternatives rejected

**Migrate existing ids to the new shape.** This would give the database one id
length, which is the only thing the coexistence costs. It buys that with a
rewrite of primary keys, every final media object key that embeds them, and
every link already handed out — and a partial failure leaves media orphaned
from its rows. The addresses a reader already has are the product's promises;
the readable segment is what they read, and it is present either way.

**Keep the 32-character ids.** No break, but two thirds of every address stays
noise, and the mint would still be duplicated on both sides.

**Case-fold ids on read.** Reconciles a retyped link against a case-sensitive
key, which converts a copy-paste failure into a possible collision. Ids are
copied, not typed.

**Persist or lengthen the slug instead.** A separate decision about uniqueness,
rename redirects and slug history. The id remains the identity, so shortening it
is the change that helps every address regardless of the name.
