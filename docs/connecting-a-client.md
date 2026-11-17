# Connecting a client

Arcula hosts an MCP server on the same origin as the app:

| Environment | Endpoint                         |
| ----------- | -------------------------------- |
| production  | `https://arcula.art/api/mcp`     |
| dev         | `https://dev.arcula.art/api/mcp` |

A client reaches it over **Streamable HTTP** speaking MCP **2026-07-28**. The
server is stateless: one request, one JSON answer, no session to keep.

Arcula is its own OAuth 2.1 authorization server. A client identifies itself
with a **Client ID Metadata Document** (CIMD); dynamic client registration is
off. A client that only speaks the legacy `initialize` handshake, or that can
only register dynamically, will not connect — pick one that supports the
2026-07-28 revision and CIMD.

## OpenCode

Add the server globally (or omit `--global` for one project):

```sh
opencode mcp add arcula --global --url https://arcula.art/api/mcp
```

OpenCode opens servers with the legacy handshake by default, so pin the
revision in `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "arcula": {
        "type": "remote",
        "url": "https://arcula.art/api/mcp",
        "protocol": "2026-07-28",
      },
    },
  },
}
```

Then run **`/mcps`**, select `arcula`, and sign in. The browser opens Arcula's
sign-in and then the consent screen, which names OpenCode and the localhost
redirect it will use; approving it creates the Connection. Back in OpenCode the
server shows as connected, and the nine tools appear under the `arcula` prefix
(or `tools.arcula.*` in Code Mode).

For dev, use the same setup with `https://dev.arcula.art/api/mcp` and a
different name (for example `arcula-dev`) so the two sign-ins do not collide.

If a sign-in is interrupted, clear the stored credentials and start again:

```sh
opencode mcp logout arcula
```

## Other clients

Add `https://arcula.art/api/mcp` as a remote MCP server or connector and
complete the OAuth flow in the browser. If the client cannot pin the
2026-07-28 revision or does not support CIMD, it cannot use this endpoint.

## What the agent can do

Nine tools, named for the product's nouns: list and read a Catalogue, create
and update one; search and read an Artwork, create and update one; and import a
batch of works. A Catalogue's Kind is fixed at creation; the fields a Catalogue
records decide what a save may carry and what a read answers.

Imports land as **Drafts** by default, so a misread row is something the member
deletes rather than a page the public reads. Reads are unmetered; writes are
metered per account (20 writes in a rolling 20-second window and 5 imports an
hour). An agent cannot upload media, delete anything, transfer ownership,
change a password or send an invitation.

## Disconnecting

The account profile lists every Connection under **Connected apps** with when
it connected and last acted. **Revoke** ends that client's access immediately
and leaves the browser session and every other Connection alone. Removing the
server from the client's configuration only stops that client asking; the
Connection remains listed until it is revoked.

A Connection is one per account and client. Two installs of the same client
share one Connection and are revoked together; a different client is a
separate row.
