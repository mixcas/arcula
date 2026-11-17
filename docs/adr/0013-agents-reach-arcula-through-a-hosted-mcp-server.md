# Agents reach Arcula through a hosted MCP server

**Status**: accepted

Arcula has had exactly one client: a browser. Every credential is a Better Auth
session cookie, every authorization decision is a membership fact read from rows
([ADR-0004](0004-collections-are-shared-by-membership.md)), and the only
machine-shaped affordance in the tree is `plugins: [bearer()]` — a session token
accepted as an `Authorization` bearer, added for the tests and the deploy
verifier and invisible to every person who uses the product. There is no API
key, no rate limiter anywhere, and no second way to act as an account.

People who work inside an agent want it to act on their catalogue: read the
works, create them from a document they already have, collapse artist spellings
that drifted in from the material they imported, write a short description. That
is a second client, and it needs a way in.

Three facts shaped the decision.

**An agent can carry a decision but never a file.** A vision model sees a
rendered, resized image; it does not have the encoded bytes, so it cannot
reproduce them. Tool arguments are JSON, so "the agent uploads the photo from
the PDF" is not expensive, it is impossible — at any size. Any design that asks
an agent to move pixels has misunderstood what it is.

**The protocol decides less than it looks.** MCP is a tool-descriptor format and
a transport. What a remote server actually owes a client is OAuth: RFC 9728
protected-resource metadata, RFC 8414 authorization-server metadata, PKCE,
resource indicators. A remote server is therefore also an authorization server
refusing anonymous callers.

**That authorization server is nearly free here.** Better Auth is already the
identity system, and `@better-auth/mcp` plus `@better-auth/cimd` ship at the same
version line as core. Disconnecting the protocol from the cost: a hosted agent
surface is a plugin, a consent page and a mount on a route, in the app that
already exists.

## Decision

**The agent surface is a hosted MCP server, on the existing Lambda, on the
existing origin.** Streamable HTTP, stateless per request — a fresh server
instance per request, no session store, no shared bus — which is both what the
current protocol revision (2026-07-28) natively describes and the only shape a
Lambda serves well. The endpoint is `/api/mcp`, under the prefix the SPA already
refuses to serve; the web app and the agent share one origin, so there is no
second deploy, no second CORS rule and no second copy of the authorization
logic.

**Arcula is its own OAuth 2.1 authorization server.** `@better-auth/mcp`
publishes the discovery documents, runs the consent screen, issues and refreshes
tokens, and binds each token to the resource; `@better-auth/cimd` supplies
Client ID Metadata Documents, which is the spec's preferred client identity and
means no dynamic-registration endpoint to run. The MCP handler receives a
verified subject and hands it to the tool layer; nothing in the tool layer
handles an unverified token.

**A connection is a named, revocable thing.** An account may hold several at
once — a laptop, a desktop client, a second machine — each listed with the client
that made it, when it connected and when it last acted, and each revocable on
its own. Revoking one never signs the person out of the website, and connecting
one never grants the website session. The browser session and the agent
connection are two credentials for the same account, and neither is the other.

**The tools speak the product's vocabulary and the agent composes them.** Not one
tool per route: nine intent-level tools — list and read Catalogues, create and
update one, search Artworks, read/create/update one, import works — whose
descriptions carry the rules a person would otherwise have to be told (the Kind
is fixed at creation; a Collection carries no Availability; the free tier owns
ten Catalogues). Their names use Catalogue and Artwork, never the deprecated
`collection`.

**The tool layer calls the modules, never the routes.** `authorize.ts`,
`artworkRead.ts`, `artworkSave.ts` and the pure verdicts hold the rules; an MCP
tool parses its arguments through the shared schema and calls the same module
the route calls, mapping failures to tool results. Replaying the Hono app
in-process was rejected: `requireSession` resolves a Better Auth cookie, so route
replay would mean synthesising a session header from a token and then trusting
it — a new trust boundary inside the process, to avoid a mapping table.

**An agent's import lands Drafts; a person's CSV import still lands Published.**
A person imports through a review table and edits it before running it. An agent
imports through a conversation, and a hallucinated artist or a misread caption
must not appear on a public page in the same second it was invented. The server's
import contract gains one explicit `status`, defaulting to `published` so the CSV
route is byte-for-byte unchanged; the agent's tool sends `draft`.

**The read surface diverges from the web's, deliberately and narrowly.** The
agent's search is one general structured read — multi-value filters (OR within a
field, AND across fields), normalized text matching, a stable sort, capped
`limit`/`offset`, a total count and a `facets` parameter over the filtered set.
It exists because a mechanical list of every work with its photos and documents
costs a quarter of a context window to answer "which works are by this artist",
and because a tool per question is a surface that has to be extended for every
new question. The filtering stays in the API over the rows the list already
reads: no pushdown, no index, no migration, exactly as the member-only `q` does
today.

**Writes are metered per account, keyed by the token's subject.** A remote MCP
call arrives from Anthropic's cloud, not from the person's machine, so the
gateway's `sourceIp` is one bucket for every user and address-keying is
meaningless. The limiter is a per-account token bucket on writes; reads are
unmetered.

**The undeclared credential closes.** `bearer()` is gated off in production and
`apps/api/scripts/deploy-verify.ts` moves to session cookies. Leaving it alive
would mean two ways to act as an account from outside a browser: a named,
listed, revocable connection, and a session token nothing names.

## Considered Options

- **A local stdio MCP server.** Rejected as the product's shape. It reaches only
  clients that can launch a process, and only people who will hand-edit
  `claude_desktop_config.json`, install a runtime and paste a token into it.
  Arcula's audience is collectors, artists and galleries. It also needs a
  machine credential the product does not have — the only one available is the
  seven-day session token.
- **A personal access token pasted into a connector.** Rejected. Remote MCP
  clients speak OAuth; the static-header alternative is beta and limited to a
  set of organizations, so it is not a shippable path. A PAT also cannot express
  "this connection, on this machine, revocable without touching my session".
- **Tools per REST route.** Rejected. Thirty tools whose discovery would be a
  worse problem than the one they solve, and whose names would mostly be
  mechanics (`bulk-delete`, `sweep`) rather than acts.
- **Images through tool arguments.** Rejected as impossible, not merely costly:
  see above.
- **A server-side PDF/PPT import pipeline.** Deferred, not rejected. It is worth
  building — for every member, with or without an agent — but it is a larger
  piece than the agent surface itself, and it inverts the boundary this record
  keeps: the file is parsed where it is, and Arcula receives works.
- **Media tools in the first release.** Deferred. They can only complete on a
  client that can make an outbound `PUT` to the presigned URL, so on Claude Code
  and never on Claude Desktop. A tool that dead-ends on one of the two supported
  clients is worse than a tool that does not exist.
- **Sequence filters pushed into SQL.** Deferred. The existing stance is
  deliberate and unchanged: the filter runs over rows the list already read. The
  point of the agent's paging is the agent's context, not the database's work.
- **Rate limiting by address.** Rejected as meaningless under a cloud-hosted
  client, and as the wrong unit besides: what must be bounded is one account's
  write volume.
- **One tool that takes a ghost of the web form's kind rules.** Deferred:
  `catalogueSurface.ts` lives in `apps/web`, so a strict tool would need that
  table moved to `packages/shared` first. The first release is permissive about
  Availability on a Collection, exactly as the API is; nothing renders it
  publicly.

## Consequences

- **A new client, and a new public endpoint.** `/api/mcp` is reachable from the
  internet and will be probed. The SPA fallback must learn that `/.well-known/*`
  is not a client route — today it serves `index.html` for every non-`/api`
  path, which would answer OAuth discovery with HTML.
- **A second credential exists.** Account surface gains a "Connect an agent"
  block and a Connected apps list; `bearer()` leaves production and
  `deploy-verify.ts` authenticates with cookies.
- **The free tier is now reachable by an agent.** The ten-Catalogue cap arrives
  as `limit-reached`, and the tool surface must relay it verbatim so the agent
  can explain it rather than retry it.
- **A rate limiter exists for the first time**, with the unlock throttle as its
  only precedent and its opposite: an account bucket, not an address counter.
- **The API contract grows.** One structured search on the existing artwork list
  read (shared schema, pinned both sides) and one `status` on the import
  payload. Both are additive; neither needs a migration.
- **Deferred.** The Import pipeline (a dropped PDF or PowerPoint becoming works
  and images), media tools, facets beyond artworks, a kind-aware tool surface
  once `catalogueSurface.ts` moves to `packages/shared`, and any tool that
  destroys: an agent neither deletes a Catalogue nor an Artwork, transfers
  ownership, changes a password, or sends an invitation.
