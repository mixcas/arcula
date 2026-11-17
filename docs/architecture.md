# Architecture map

The module-level map of the repository: what each file in the API, the shared
contract, the web app, the database and the stack owns. `AGENTS.md` is the
working guide (commands, branches, validation); `DESIGN.md` is the as-built
design record the map points into, including the request path.

## Where things live

**`apps/api/src/`**

- `app.ts` — the Hono app: the error envelope, the `www`→configured-origin
  redirect, CORS, route mounting. `main.ts` runs it under Bun; `lambda.ts` is
  the Lambda handler. `env.ts` reads the configuration once; `responsePolicy.ts`
  holds the pure decisions derived from it.
- `access.ts` — the access verdicts, pure over loaded rows: the membership
  fact (owner, collaborator, nobody) and the visitor rule (the catalogue is
  the only gate, with an Access grant as the second condition on a Protected
  one); `authorize.ts` loads the catalogue, the viewer's membership row and
  the row each route acts on, reads the grant (`grantHeld`, from the cookie
  named for that catalogue) where a visitor needs one, and answers the one
  write question — `requireMemberCatalogue` / `requireMemberArtwork`, owner or
  collaborator — that every write path asks.
- `catalogueGrants.ts` — the Access grant's pure facts: `mintGrantToken`,
  `hashGrantToken`, `grantCookieName` and `isGrantUsable` (not past
  `expiresAt`); `GRANT_TTL_MS` (twelve hours) is the one number behind both the
  cookie's `Max-Age` and the row's expiry. No database and no Hono — the unlock
  route mints and stores, the read paths load the row and ask this.
- `cataloguePassword.ts` — hashing (`hashPassword`) and the check
  (`verifyPassword`) for a catalogue's password.
- `catalogueScope.ts` — the membership scope the reads share: the left join
  to the caller's collaborator row and the live-catalogues where-clause — the
  catalogues the caller owns or collaborates on — used by the signed-in
  `/catalogues` list and the Artist Name aggregate so the two cannot drift.
- `unlockThrottle.ts` — the throttle's policy and nothing else: `UNLOCK_WINDOW_MS`
  (ten minutes, **fixed**, and why not sliding) and `unlockWindowStart`, which
  floors an attempt to the window it belongs to. `clientAddress.ts` — the
  address the counter is keyed by: the Lambda entry writes the gateway's
  `sourceIp` into `x-arcula-client-ip` with `set`, so a client cannot choose its
  own, and no forwarding header is ever trusted; locally the header is absent
  and every attempt shares one bucket.
- `artworkRead.ts` — the single read path for Artworks: one work (the
  Catalogue, the work, its photos, documents and Variants), or a Catalogue's
  list — live, or the member-only Deleted one, most recently deleted first —
  loading the Catalogue and each child table once for the whole page (at most
  five queries, six for a collaborator's membership row) and returning ok,
  not-found, unauthorized or forbidden for the list. The live list also takes
  an optional member-only search (`q`), refused ahead of the visitor verdict and
  filtering the rows the list already read — drafts included, deleted works
  never, and only the fields the Catalogue records. The verdict is
  `access.ts`'s over rows the module loads through `authorize.ts`, with the
  request's grant validity handed in as a fact; the module carries no Hono type
  and the route owns the wire code. The save routes read their work back
  through it.
- `artworkFieldRefusal.ts` — the one refusal a save earns when it names an
  Artwork field its Catalogue turned off: `assertArtworkFieldsEnabled` resolves
  the Catalogue's enabled set through the shared registry and throws
  `field-disabled` (400), with the offending fields in `error.fields` and named
  in the message. The create and update artwork routes call it after parsing and
  before the transaction opens, so a refused save moves no row.
- `artistNames.ts` — the caller's Artist Name suggestions for the artwork form:
  the aggregate read over live works in the live catalogues the caller owns or
  collaborates on (the caller scope recorded in
  [ADR-0009](docs/adr/0009-artist-name-suggestions-are-caller-scoped.md)), and
  the pure collapse of case and accent variants to one most-used spelling,
  ordered by use then display name and silently capped at 2,000. No Hono type;
  the route owns the wire and `401`, and the future curated index can replace
  the module's source behind the same contract.
- `spa.ts` — splits `/api/*` from the SPA and serves `WEB_DIST`.
- `auth.ts` — the Better Auth instance (Drizzle adapter). `session.ts` resolves
  the caller.
- `invitations.ts` — the pure token algebra (`mintInvitationToken`,
  `hashInvitationToken`) and the two questions the routes ask
  of a row: `isInvitationUsable` (pending and not past `expiresAt`) and
  `isInvitationResendable` (pending, and the last issue older than the
  60-second cooldown — expiry is deliberately not part of it).
- `routes/` — `catalogues` (the reads, the settings write — the Artwork fields
  deviations included — `…/unlock`, the import, which strips a field the
  Catalogue does not record before validation, the Deleted list and the batch
  delete/restore), `access` (the access
  read, removal, leaving and transfer), `invitations` (create,
  resend, revoke, public preview, accept, decline, the invitee's inbox and
  in-app decline), `artworks`, `artworkSave` (the write half of a save: the
  staged entries promoted, upserted and deleted once the payload validates),
  `artistNames` (the caller's suggestion read), `me`, `media` (the object
  proxy), `artworkMedia` (the presign and process routes: the browser PUTs the
  bytes straight to storage under the caller's own staging prefix, and process
  is the point the server validates them —
  [ADR-0012](docs/adr/0012-media-uploads-go-direct-to-storage.md)).
- `media/` — `keys.ts` (the object-key algebra), `pipeline.ts` (Sharp),
  `populations.ts` (what distinguishes photos from documents: tables, variants
  and key shape; the caps and types are the shared guard's),
  `variants.ts` (the geometry), `promote.ts`
  (staged → final), `stagedName.ts` (the original's filename, the one thing
  that rides a signed header rather than a key or a query).
- `email/provider.ts` — SMTP locally, Resend in production. Sharing adds exactly
  two mails, the invitation and the ownership-transfer notice; a provider
  failure surfaces as `emailSent: false`, never as a failed write.
- `storage.ts` — the S3 client (`S3_ENDPOINT` is required; it refuses a default)
  and `presignPut`, the short-lived single-object URL the browser PUTs a staged
  original to ([ADR-0012](docs/adr/0012-media-uploads-go-direct-to-storage.md)).

**`packages/shared/src/`** — the contract: `schemas/` (access, artwork,
artworkImport, artistNames, catalogue, invitation, document, media, user),
`artworkFields.ts` (the Artwork fields registry: the thirteen togglable keys,
the two fixed ones, the per-Kind defaults, `resolveArtworkFields`,
`normaliseArtworkFields` and `disabledArtworkFieldsIn`, the predicate the save
routes and the import share),
`artworkPhotos.ts` (the `order` invariant, `sortPhotos`/`reindexPhotos`, the
`photoUrl` ladder), `artworkSearch.ts` (the Catalogue search predicate over the
fields a Catalogue records — Title and Artist Name always, the other eight only
while enabled — its caps, the query suffix helper and `normalizeSearchText`,
which Artist Name suggestions also collapse on), `caps.ts` (file caps + accepted
types), `stagedUpload.ts` (the headers a staged presigned PUT signs — the list
the media bucket's CORS rule must allow, read by path from `infra/cdk`'s test
because that package is not a workspace member), `limits.ts` (the
per-tier catalogue cap), `pdfFallback.ts` (the Catalogue PDF fallback face's
character rule — `pdfFallbackCharacters`, the distinct code points above
U+007F, ascending, and `pdfFallbackChunks`, that string split by code point at
`MAX_PDF_FALLBACK_CODE_POINTS`; the web export and the API subsetter both read
it, so the two sides cannot drift),
`email.ts` (`normalizeEmail`, the trim-and-lowercase both sides use),
`invitationTime.ts` (the invitation durations and the two questions the access
card asks of a row), `ids.ts` (the one mint — `ID_LENGTH`, `ID_ALPHABET`,
`MINTED_ID_SHAPE_RE`, `mintId`; ten base62 characters, older ids permanent),
`slug.ts`, `types.ts`. `schemas/artwork.ts` holds `artworkStatusSchema` and
`artworkAvailabilitySchema` (`available`/`reserved`/`sold`/`on-consignment`,
both pinned to their client types); the save schemas accept availability as
`.nullable()`, the create treating an absent key as null and the update as
"leave it alone", and the read schema makes it optional because a visitor's
document does not carry it. The API never validates it against the Kind; the
create and update routes refuse it only when the Catalogue's Artwork fields turn
it off. `schemas/catalogue.ts` holds `catalogueKindSchema`
(`portfolio`/`collection`/`inventory`, pinned to `CatalogueKind`) and
`artworkFieldDeviationsSchema`, the sparse map keyed by the registry's thirteen
names; the create schema accepts `kind` defaulting to `collection` and does not
accept the map, so a new Catalogue is its Kind's defaults with nothing stored,
and the update schema accepts the map nullable and optional, so an absent key
leaves the column alone. `schemas/document.ts`'s `catalogueReadSchema` carries
both, the deviations on every audience because the public PDF resolves them; the
API's serializer validates a row against the three kind values
(`catalogueKindOf`) and the deviation map before emitting them.

**`apps/web/src/`** — `App.tsx` routes; `catalogueSurface.ts` is what a kind
means for the surface, as data: the kind's colour (`kindColor`, a literal union
the screens turn into a CSS variable through `kindColorVar`), the labels, the
four market-state words, whether the catalogue's name is the artist's name, and
`newArtworkForm` — what a create form starts as on one Kind, given the resolved
Artwork fields. `services/` are the API clients (`api.ts` is the transport);
`auth/` is the Better Auth React client; `telemetry/logRocket.ts` is the
session-replay hook, redacted at the client
([ADR-0011](docs/adr/0011-session-replay-is-redacted-at-the-client.md));
`components/manage` and `components/catalogue`; `skins/` is the public-view
system.

The Artwork fields registry (`@arcula/shared`) decides what the Add and Edit
forms render: a disabled field has no input, and the save omits its key rather
than clearing it, so a hidden value survives. Availability is one of those
fields — a Catalogue on any Kind may record it, the form offers the same four
states everywhere, and a new work starts Available when it is recorded. The
Add page also opens a Portfolio's new work credited to the portfolio's artist,
and it builds every Kind's form from that one resolved answer rather than
branching on the market state; a typed name wins, and the Edit page shows the
artist the work records.
The manage page and the Deleted view resolve `showAvailability` from the
Catalogue's Kind and stored deviations, not from the Kind alone, and no public
page renders availability at all; the API emits it on a member read only.
The General tab's Artwork fields card edits the same resolved set, and its save
fold (`catalogueSettingsSave.ts`) normalises it back into the sparse map. The
Catalogue PDF's preflight filters its printed columns by the enabled set, and
the CSV import offers only enabled fields as mapping targets and names the
columns it skipped.

**`packages/db/src/index.ts`** — the Drizzle tables (`user`, `session`,
`account`, `verification`, `catalogues`, `catalogueCollaborators`,
`catalogueInvitations`, `catalogueAccessGrants`, `catalogueUnlockAttempts`,
`artworks`, `artworkPhotos`, `artworkPhotoVariants`, `artworkDocuments`) and the
`schema` object the adapter consumes. The Drizzle entity is `catalogues` and the
relation property is `catalogueId`, but the physical Postgres tables keep their
`collections` / `collection_*` names and the physical column stays
`"collectionId"` — a storage rename is a non-additive migration (ADR-0010). The
two sharing tables are in the schema
and `catalogueCollaborators` is read on every
access question; the invitation routes write `catalogueInvitations`, while the
code that writes `catalogueCollaborators` covers acceptance, removal, leaving
and transfer, which swaps the two membership rows and rewrites the owner.
`catalogues.passwordHash` is the one password fact; `catalogueAccessGrants`
holds a grant's token hash and its expiry, and `catalogueUnlockAttempts` is the
unlock throttle's counter — `(ip, catalogueId, windowStart)` with `attempts`,
written and read by the unlock route alone.
`packages/db/migrations/` is generated; hand edits are the documented exception,
and there are exactly three: a data backfill appended to the generated file, the
add-nullable → backfill → set-not-null sequence for a column that cannot be
added `NOT NULL` on an existing table, and a grant revoke drizzle-kit cannot
model — it renders schema, never grants, so `0006_enable_rls` appends its
guarded block by hand. The sharing schema is the worked example of the first
two: those migrations are described in `packages/db/README.md` and in
`DESIGN.md`'s data model; the third is in that README and `0006_enable_rls.sql`.

**`infra/cdk/src/arcula-stack.ts`** — the stack. `contextValue("DOMAIN")` gates
the custom domain; the apex and `www` are **separate** `DomainName` pairs that
each get their own regional endpoint — an HTTP-API custom domain serves only its
exact host, so pointing `www` at the apex target is the `403` the layout is built
to avoid.
