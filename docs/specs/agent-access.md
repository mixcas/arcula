# Agent access

**Status: implementation-ready.** This is the contract for Arcula's agent
surface: a hosted MCP server that lets a person drive their Catalogues and
Artworks from an agent. The decision and its rejected alternatives are
[ADR-0014](../adr/0014-agents-reach-arcula-through-a-hosted-mcp-server.md); this
document is the build.

The product vocabulary is [GLOSSARY.md](../../GLOSSARY.md)'s: **Catalogue**,
**Artwork**, **Kind**, **Draft**, **Published**, **Availability**, **Owner**,
**Collaborator**, **Connection**, **Import**. The tools say those words and
never the deprecated `collection`.

## What it is

A **Connection** is an agent's standing access to one account: approved by the
person behind a consent screen, named by the client that made it, listed beside
the account's other connections, and revocable on its own. It is a second
credential for the account and never becomes the person's browser session.

The agent surface is an MCP server, hosted on the existing Lambda, on the
existing origin. It is **not** a second API: every tool calls the module a route
calls, under the same membership verdicts.

## The endpoint

- **`POST /api/mcp`**, Streamable HTTP, stateless — a fresh server per request
  and nothing held between them. `@modelcontextprotocol/hono`'s `createMcpHonoApp`
  is an ordinary Hono mount; `createMcpHandler(factory)` builds the per-request
  server.
- The path is under `/api`, which the SPA fallback already refuses
  (`apps/api/src/spa.ts`). **`/.well-known/*` must become a second refusal** —
  today every non-`/api` path that is not a file gets `index.html`, so OAuth
  discovery would be answered with an HTML page.
- The resource URL is `PUBLIC_URL` + `/api/mcp`, and it is the token's audience.
  Dev and production each mint their own; nothing is shared between them.
- **No tool may stream.** API Gateway's HTTP API integration timeout is 30 s and
  cannot be raised. Every tool answers one result and ends.

## Authorization

`@better-auth/mcp` plus `@better-auth/cimd`, at the version line core runs.

- The plugin publishes RFC 9728 protected-resource metadata and RFC 8414
  authorization-server metadata, runs PKCE (S256), binds every token to the
  resource audience, and refreshes tokens.
- Client identity is a **Client ID Metadata Document**, the spec's preferred
  form; dynamic client registration stays off. A person adds the endpoint's URL
  in their client's connector settings and signs in.
- An unauthenticated request answers `401` with
  `WWW-Authenticate: Bearer resource_metadata="…"`. A `200` carrying that header
  is ignored by clients and is not a challenge.
- The consent screen names the Connection and its client, both of which the
  Connected apps list repeats later.
- The tool layer receives a **verified** subject. It never parses a token.

Exact well-known paths are the plugin's to publish; confirm them against the
installed version before mounting, and make the SPA exception match.

## The tool inventory

Nine tools. Names are the contract; descriptions are prompt text and are
reviewed like UI copy.

| Tool               | Arguments                                                       | Answers                                                     |
| ------------------ | --------------------------------------------------------------- | ----------------------------------------------------------- |
| `list_catalogues`  | —                                                               | the caller's owned and shared Catalogues, with their role   |
| `get_catalogue`    | `catalogueId`                                                   | one Catalogue: kind, visibility, counts of works by status  |
| `create_catalogue` | `name`, `kind`, `description?`                                  | the new Catalogue                                           |
| `update_catalogue` | `catalogueId`, `name?`, `description?`, `isPublic?`             | the Catalogue as written                                    |
| `search_artworks`  | `catalogueId`, filters, `sort?`, `limit?`, `offset?`, `facets?` | a page of work summaries, the total match count, and facets |
| `get_artwork`      | `catalogueId`, `artworkId`                                      | one work, full record                                       |
| `create_artwork`   | `catalogueId`, the writable fields                              | the new work                                                |
| `update_artwork`   | `catalogueId`, `artworkId`, the fields to change                | the work as written                                         |
| `import_artworks`  | `catalogueId`, `rows[]`, `status?` (default `draft`)            | `{ inserted, rejected }`                                    |

Every write is member-scoped through `requireMemberCatalogue` /
`requireMemberArtwork`; an owner and a Collaborator may do exactly what they may
do in the app. Reading is the visitor verdict for a non-member, which under OAuth
means a caller whose account has no membership row gets the same `forbidden`
the web gets.

`kind` is **required** on `create_catalogue`: a default is a coin flip the agent
cannot see, and the Kind is fixed at creation — `update_catalogue` has no such
argument, and the API silently ignores one.

The descriptions carry three rules the schema cannot express:

- **Kind is fixed at creation**; a Portfolio's name is the artist's name and its
  description is their bio; an Inventory's are the gallery's.
- **A Catalogue records a chosen set of Artwork fields.** `create_artwork` and
  `update_artwork` name only fields the Catalogue records; one it has turned off
  is refused with `field-disabled`. Availability is one of those fields: on by
  default for a Portfolio or an Inventory, off for a Collection.
- **The free tier owns ten Catalogues**; exceeding it answers `limit-reached`,
  which is terminal and is relayed to the person, not retried.

### `search_artworks`

One general read on the existing list route
(`GET /api/v1/catalogues/:catalogueId/artworks`), extended rather than
duplicated, so there is one authorization verdict and one place where "a
visitor sees published works only" is true.

- **Filters are the ten search fields the text search already declares**
  (`packages/shared/src/artworkSearch.ts`) plus the two enumerated ones:

  | Group | Fields                                                                                                                            |
  | ----- | --------------------------------------------------------------------------------------------------------------------------------- |
  | text  | `title`, `artistName`, `serie`, `medium`, `editions`, `dateOfCreation`, `acquisitionDate`, `placeOfOrigin`, `provenance`, `notes` |
  | enum  | `status` (`published` \| `draft`), `availability` (`available` \| `reserved` \| `sold` \| `on-consignment`)                       |

- **Repeating a parameter means OR within that field; different fields AND.**
  `artistName=Matisse&artistName=Picasso&medium=Oil` is "either artist, and
  oil". At most 20 values per field and at most 8 fields per request; more is
  `400 validation`.
- **Text matches normalized, enums match exactly.** Both sides go through
  `normalizeSearchText` (NFD, diacritics stripped, lowercased); an enum value
  outside its list is `400 validation`, never ignored.
- **`q` still works and ANDs with the filters.** An absent, empty or
  whitespace-only `q` leaves the result unchanged, as today.
- **`sort`** is `updated` (default, newest first), `title`, `artistName` or
  `dateOfCreation`, each with `id` as the tiebreak so offset paging cannot skip
  or duplicate a row.
- **`limit`** absent means every match, which preserves the web's behaviour;
  present, it is capped at 100. **`offset` without `limit`** is
  `400 validation`.
- **The response is a page envelope**: `{ artworks, total, limit, offset }`,
  where `total` is the match count before paging. The web reads `artworks` and
  changes in the same release; the client and the server ship as one Lambda, so
  the two halves cannot skew.
- **`facets`** names one or more filterable fields and adds
  `facets: { <field>: [{ value, count }] }`, counted over the **filtered** set —
  so "artist names among oil paintings" agrees with the page. Entries are sorted
  by count descending then value, and capped at 500 per field.
- A work summary is **id, title, artistName, status, availability, medium,
  dateOfCreation, updatedAt** — never photos, documents or variants.
  `get_artwork` is how a caller asks for the full record.
- **Drafts are included and Deleted works never are**, for a member; a visitor
  gets published works only. This is the existing list's rule, unchanged.

The filtering stays in the API, over the rows `artworkRead.ts` already read: no
SQL pushdown, no index, no migration. `artworkRead.ts` remains the single seam
to replace if a Catalogue's size ever demands it.

### `import_artworks`

`POST /api/v1/catalogues/:catalogueId/import` — the CSV route, one optional
field wider.

- The payload is `artworkImportSchema` plus `status?: "published" | "draft"`,
  defaulting to `IMPORTED_WORK_STATUS` (`published`) at the route.
  `IMPORTED_WORK_STATUS` stops being "the status every imported work lands with"
  and becomes the default; its doc comment says so.
- The MCP tool always sends `draft`. A person's CSV import sends nothing and is
  unchanged.
- Validation is the existing per-row contract: each row is parsed against
  `artworkSchema`, a failing row lands in `rejected` with its index and its
  failed fields, and the accepted rows are written in one transaction.
- **At most 200 rows per call**, enforced by the tool's own schema — the route
  is unchanged, and a larger request is a validation error naming the cap.
- The status the payload names wins over any status a row carries.

## Errors

Every tool failure is an MCP error result whose text is the envelope's code and
message, so the agent can relay it verbatim:

| Code            | Meaning for the agent                                     |
| --------------- | --------------------------------------------------------- |
| `validation`    | terminal — fix the arguments                              |
| `unauthorized`  | terminal — the connection is gone; re-connect             |
| `forbidden`     | terminal — this account may not do this here              |
| `not-found`     | terminal — no such Catalogue, work or membership          |
| `conflict`      | terminal — the state does not allow it                    |
| `limit-reached` | terminal — the tier's allowance is spent; tell the person |
| `rate-limited`  | retryable after the window                                |
| `internal`      | retryable once; then tell the person                      |

## Rate limiting

A per-account token bucket on **writes only**; reads are unmetered.

- Keyed by the token's subject, **not** by address: a hosted agent's calls
  arrive from Anthropic's cloud (`160.79.104.0/21`), so one address bucket would
  be one bucket for every user in the product.
- `AGENT_WRITE_CAPACITY = 20`, refilled at one per second — 60 writes a minute
  sustained. Imports are writes and additionally capped at **5 an hour**.
- Both are fixed windows in a new table on the `catalogueUnlockAttempts` pattern
  (`(userId, windowStart)` with a count, written by one atomic upsert), because
  the Lambda holds no state between requests. **The migration ships alone**
  ([AGENTS.md](../../AGENTS.md) → _A schema change ships alone_).
- Exhausted answers `429 rate-limited` with a message naming the allowance and
  the window, and no `Retry-After` header — the product's one precedent
  (`too-many-attempts`) omits it, and the message says enough.

## The account surface

One screen: the account profile under `/manage`. Two parts.

- **Connect an agent** — the endpoint URL with a copy button and one sentence
  saying that the agent acts as you and can be disconnected below. A product
  feature whose entry point is a docs page is a developer feature.
- **Connected apps** — one row per Connection: the client that made it, when it
  connected, when it last acted, and Revoke. Several rows are normal. Revoking
  ends that Connection's tokens and leaves every other Connection and the
  browser session untouched.

`plugins: [bearer()]` is removed from production. `apps/api/scripts/deploy-verify.ts`
authenticates with session cookies instead; the tests that assert the bearer
path move to the session path or are deleted.

## Tests

Three, and nothing else — `docs/testing.md`'s criterion is the filter.

1. **The challenge.** An unauthenticated `POST /api/mcp` answers `401` with a
   `resource_metadata` parameter. Ours to break by mounting the handler wrong.
2. **The search mapping.** Multi-value filters become OR-within / AND-across,
   `limit`/`offset`/`sort`/`facets` pass through, an unknown field and an
   `offset` without a `limit` are rejected. Pure mapping over our own schema.
3. **Drafts, not Published.** An `import_artworks` call lands drafts; the CSV
   path lands published. This is the record's one behavioural decision and the
   first thing a later refactor will silently unify.

Not tested here: the SDK's transport, Better Auth's token issuance, the consent
screen's markup. The library tests itself; a red test would teach us nothing the
diff does not show.

## What is not in the first release

- **No media tools.** The bytes can only be uploaded by a client that can make an
  outbound `PUT` — Claude Code can, Claude Desktop cannot — and a tool that
  dead-ends on half the supported clients is worse than an absent one.
- **No destructive or administrative acts**: no deleting a Catalogue or an
  Artwork, no bulk delete or restore, no ownership transfer, no removing a
  Collaborator, no password, no invitation. Two of those send mail, and a
  deleted Catalogue has no restore in the app.
- **No file parsing.** The agent reads the PDF or PowerPoint and sends rows;
  Arcula never sees the file.

## Deferred

The **Import** pipeline itself — a dropped PDF or PowerPoint becoming works and
images, reviewed on a screen, with extracted images named by page so the
deterministic case needs no model at all. Media tools once a client-facing
upload path exists. Facets over Catalogues, artists and other resources. A
kind-aware tool surface, which needs `catalogueSurface.ts` moved from `apps/web`
to `packages/shared` first. A local stdio server, which would be a thin shell
over this same tool module.
