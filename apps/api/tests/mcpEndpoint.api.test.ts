// The endpoint and its discovery documents, on the wire.
//
// One assertion for the challenge — the thing a client's whole authorization
// flow hangs on — and one per discovery document, because the SPA fallback is
// what would otherwise answer them with the app's HTML and every MCP client
// would fail at step one.
//
// The challenge is deliberately checked with a body of `{}`, no protocol
// headers and no token: `requireMcpAuth` wraps the transport, so the 401 comes
// before the SDK ever parses the request. If the mount moves inside the
// handler, this goes red.

import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "../src/db";
import { json, req } from "./helpers/api";

interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
}

interface AuthorizationServerMetadata {
  issuer: string;
  token_endpoint: string;
  client_id_metadata_document_supported: boolean;
}

afterAll(async () => {
  await closeDb();
});

describe("POST /api/mcp, unauthenticated", () => {
  it("answers 401 with the RFC 9728 resource_metadata challenge", async () => {
    const res = await req("POST", "/api/mcp", { body: "{}" });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain("Bearer ");
    expect(challenge).toContain("resource_metadata=");
  });
});

describe("the OAuth discovery documents", () => {
  it("answers protected-resource metadata at the bare and resource-inserted paths", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
    ]) {
      const res = await req("GET", path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toContain(
        "application/json",
      );
      const body = await json<ProtectedResourceMetadata>(res);
      // Metadata, not the app shell: the document names the resource and an
      // authorization server the client can follow.
      expect(body.resource, path).toMatch(/\/api\/mcp$/);
      expect(body.authorization_servers.length, path).toBeGreaterThan(0);
    }
  });

  it("answers authorization-server metadata at the issuer-inserted path", async () => {
    // The resource metadata names the authorization server; the AS document
    // must be at that issuer. Reading the origin from the first document makes
    // this a consistency check between the two, not a hardcoded local URL.
    const resourceMetadata = await json<ProtectedResourceMetadata>(
      await req("GET", "/.well-known/oauth-protected-resource"),
    );
    const resource = new URL(resourceMetadata.resource);
    const issuer = `${resource.origin}/api/auth`;

    const res = await req(
      "GET",
      "/.well-known/oauth-authorization-server/api/auth",
    );
    expect(res.status).toBe(200);
    const body = await json<AuthorizationServerMetadata>(res);
    // The RFC 8414 document a client probes after reading the resource
    // metadata. `issuer` is what the client validates the authorization
    // response's `iss` against.
    expect(body.issuer).toBe(issuer);
    expect(resourceMetadata.authorization_servers).toContain(issuer);
    expect(body.client_id_metadata_document_supported).toBe(true);
    expect(body.token_endpoint).toBe(`${issuer}/oauth2/token`);
  });

  it("does not answer OpenID discovery on the app origin", async () => {
    // `/.well-known/openid-configuration` is not one of the two accepted
    // shapes (the issuer path carries it), and it is never the SPA shell.
    const res = await req("GET", "/.well-known/openid-configuration");
    expect(res.status).toBe(404);
  });
});
