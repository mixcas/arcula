# Architecture map

The module-level map of the repository: what each file in the API, the shared
contract, the web app, the database and the stack owns. `AGENTS.md` is the
working guide (commands, branches, validation); `DESIGN.md` is the as-built
design record the map points into, including the request path.

## Where things live

**`apps/api/src/`**

- `app.ts` — the Hono app: the error envelope, the `www`→configured-origin
  redirect, CORS, route mounting, `/.well-known/*` routed to the auth handler
  and `/api/mcp` to the agent guard. `main.ts` runs it under Bun; `lambda.ts` is
  the Lambda handler. `env.ts` reads the configuration once and derives the MCP
  resource (`mcpResource`); `responsePolicy.ts` holds the pure decisions
  derived from it.
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
  an optional member-only search (`q`) and the structured query — filters over
  the ten text fields plus `status`/`availability`, `sort`, `limit`/`offset`
  and `facets` — both applied to the rows the list already read, after the
  verdict: drafts included for a member, deleted works never, published works
  only for a visitor. A page answers `{ artworks, total, limit, offset }` and
  the facets counted over the filtered set. The verdict is
  `access.ts`'s over rows the module loads through `authorize.ts`, with the
  request's grant validity handed in as a fact; the module carries no Hono type
  and the route owns the wire code. The save routes read their work back
  through it.
- `artistNames.ts` — the caller's Artist Name suggestions for the artwork form:
  the aggregate read over live works in the live catalogues the caller owns or
  collaborates on (the caller scope recorded in
  [ADR-0009](docs/adr/0009-artist-name-suggestions-are-caller-scoped.md)), and
  the pure collapse of case and accent variants to one most-used spelling,
  ordered by use then display name and silently capped at 2,000. No Hono type;
  the route owns the wire and `401`, and the future curated index can replace
  the module's source behind the same contract.
- `spa.ts` — refuses `/api/*` and `/.well-known/*` (never the app shell) and
  serves `WEB_DIST` for everything else.
- `auth.ts` — the Better Auth instance (Drizzle adapter), with `jwt()`, `mcp()`
  and `cimd()` for the agent surface and `bearer()` only outside a deployment.
  `session.ts` resolves the caller.
- `mcp/` — the agent surface, with no Hono type in a tool: `guard.ts` verifies
  the access token and reads the `(sub, clientId)` consent row (touching "last
  acted" at most once a minute), `server.ts` is the per-request Streamable HTTP
  transport (`legacy: "reject"`, `responseMode: "json"`), `dispatcher.ts`
  parses a tool's arguments and claims the account's write before `call`,
  `tool.ts` declares one, `registry.ts` lists the groups and `tools/` holds
  `catalogues`, `artworks` and `import`.
- `agentLimiter.ts` — the write allowance's policy and claims: a rolling
  20-write / 20-second window summed from whole-second rows, and five imports
  per UTC hour, both in `account_write_windows`, keyed by the verified subject.
  Reads never call it.
- `catalogueWrite.ts` · `artworkWrite.ts` · `artworkImport.ts` — the write cores
  an agent and a route share: create/update a Catalogue with the tier cap,
  create/update an Artwork's fields, and import a batch with its per-row
  verdict and one transaction. They take a user id, not a Context;
  `artworkSave.ts` keeps the route's media sequence.
- `catalogueList.ts` · `catalogueCounts.ts` — the reads the Catalogue tools
  share: the signed-in owned-or-shared list (`catalogueScope.ts` is the filter,
  each row's role and a shared row's owner name) and a Catalogue's live works
  by status (a member gets every status, a visitor published only).
- `connectionList.ts` · `consentQuery.ts` — the account surface's pure halves:
  one row per client collapsed to the newest "last acted", and the signed
  consent query's rebuild and verification plus the `https:`-only client link.
- `invitations.ts` — the pure token algebra (`mintInvitationToken`,
  `hashInvitationToken`) and the two questions the routes ask
  of a row: `isInvitationUsable` (pending and not past `expiresAt`) and
  `isInvitationResendable` (pending, and the last issue older than the
  60-second cooldown — expiry is deliberately not part of it).
- `routes/` — `catalogues` (the reads, the settings write, `…/unlock`, the
  import, the Deleted list and the batch delete/restore), `access` (the access
  read, removal, leaving and transfer), `invitations` (create,
  resend, revoke, public preview, accept, decline, the invitee's inbox and
  in-app decline), `artworks`, `artworkSave` (the write half of a save: the
  staged entries promoted, upserted and deleted once the payload validates),
  `artistNames` (the caller's suggestion read), `connections` (the verified
  consent request, the account's Connections and Revoke), `me`, `media` (the
  object proxy), `artworkMedia` (the presign and process routes: the browser
  PUTs the bytes straight to storage under the caller's own staging prefix, and
  process is the point the server validates them —
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
artworkImport, artistNames, catalogue, connection, invitation, document, media,
user),
`artworkPhotos.ts` (the `order` invariant, `sortPhotos`/`reindexPhotos`, the
`photoUrl` ladder), `artworkSearch.ts` (the ten-field Catalogue search
predicate and the structured query's whole pure contract — the parse of the
raw parameters, the per-field filter predicate, the total order and the facet
counts — plus its caps, the query suffix helper and `normalizeSearchText`,
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
"leave it alone", and the read schema requires the key because the serializer
always emits it. The API never validates it against the catalogue's kind — a
Collection's work may carry one. `schemas/catalogue.ts` holds
`catalogueKindSchema` (`portfolio`/`collection`/`inventory`, pinned to
`CatalogueKind`); the create
schema accepts `kind` defaulting to `collection` and the update schema does
not, so the kind is the one field fixed at creation. `schemas/document.ts`'s
`catalogueReadSchema` carries it, and the API's serializer validates a row
against the three values (`catalogueKindOf`) before emitting it.

**`apps/web/src/`** — `App.tsx` routes; `catalogueSurface.ts` is what a kind
means for the surface, as data: the kind's colour (`kindColor`, a literal union
the screens turn into a CSS variable through `kindColorVar`), the labels, the
market states a kind offers (a Portfolio's three, an Inventory's four, a
Collection's none) with their words, whether the catalogue's name is the
artist's name, and the v1 artwork field table — every
field visible, only `title` and `artistName` required. The field table is the
data a later per-kind hiding will read; no v1 screen consumes
`visible`/`required`, and a screen that reads the module uses the labels, the
availability values, `availabilityFor`'s default and `newArtworkForm` — what a
create form starts as on one kind, values and Artist Name line together.
`services/` are the API
clients (`api.ts` is the transport); `auth/` is the Better Auth React client,
and `auth/oauthResume.ts` decides that a signed authorize query survives
sign-in; `components/auth/ConsentPage.tsx` is the Connection approval screen,
and `components/manage/AgentAccessCard.tsx` is the profile's endpoint and
Connected apps list; `telemetry/logRocket.ts` is the session-replay hook,
redacted at the client
([ADR-0011](docs/adr/0011-session-replay-is-redacted-at-the-client.md));
`components/manage` and `components/catalogue`; `skins/` is the public-view
system. The artwork Add and Edit pages load the catalogue for its kind; a
Collection's form renders no availability control and sends no key, while a
Portfolio or an Inventory defaults a surfaced work with no stored state to
`available` through `availabilityFor`, and offers only the states that kind
carries. The Add page also opens a Portfolio's new work credited to the
portfolio's artist, and it builds every kind's form from that one surface answer
rather than branching on the market state; a typed name wins, and the Edit page
shows the artist the work records.
The manage page and the Deleted view pass `showAvailability` down from
the kind; no public page renders availability at all, and the API emits it on a
member read only.

**`packages/db/src/index.ts`** — the Drizzle tables (`user`, `session`,
`account`, `verification`, `catalogues`, `catalogueCollaborators`,
`catalogueInvitations`, `catalogueAccessGrants`, `catalogueUnlockAttempts`,
`accountWriteWindows`, `artworks`, `artworkPhotos`, `artworkPhotoVariants`,
`artworkDocuments`, plus the eight agent-access tables `jwks`, `oauthClient`,
`oauthResource`, `oauthClientResource`, `oauthRefreshToken`, `oauthAccessToken`,
`oauthConsent`, `oauthClientAssertion`) and the `schema` object the adapter
consumes. The Drizzle entity is `catalogues` and the
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
written and read by the unlock route alone. `accountWriteWindows` is the agent
limiter's counter — `(userId, bucket, windowStart)` with the two buckets
`write` and `import`, claimed by `agentLimiter.ts`. The eight agent-access
tables are the JWT and OAuth provider plugins', hand-authored against
`getAuthTables()`; `apps/api/tests/adapter.test.ts` asserts every model and
field the plugin declares exists. `0011_account_write_windows` and
`0012_agent_access` are additive and landed alone, ahead of the code that
reads them.
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
