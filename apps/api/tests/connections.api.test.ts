// The account surface's wire: Connected apps and Revoke.
//
// The data is seeded directly because the OAuth provider's own flow costs a
// browser, a signed consent query and a code exchange, and the rows it would
// land are ordinary consent and refresh-token rows. What is asserted is our
// rule over them: one row per client, named and time-stamped, and a Revoke
// that ends that client's access while the session and every other client keep
// working.
//
// Two consent rows for one pair are seeded deliberately: the plugin declares
// no unique index and finds then creates, so the duplicate is a state the
// database can hold and Revoke must clear it whole.

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { oauthClient, oauthConsent, oauthRefreshToken } from "@arcula/db";
import { connectionsReadSchema } from "@arcula/shared";
import { db, closeDb } from "../src/db";
import { mcpResource } from "../src/env";
import { json, req, err, freshUser, uuid } from "./helpers/api";

afterAll(async () => {
  await closeDb();
});

interface SeedOptions {
  userId: string;
  clientId: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
  consentId?: string;
}

/** A client and one consent row: one Connection, before any tokens. */
async function seedConsent(opts: SeedOptions): Promise<string> {
  await db
    .insert(oauthClient)
    .values({
      id: uuid(),
      clientId: opts.clientId,
      name: opts.name,
      redirectUris: [`https://${uuid()}.client.test/callback`],
    })
    .onConflictDoNothing({ target: oauthClient.clientId });
  const id = opts.consentId ?? uuid();
  await db.insert(oauthConsent).values({
    id,
    userId: opts.userId,
    clientId: opts.clientId,
    scopes: ["openid"],
    createdAt: opts.createdAt,
    updatedAt: opts.updatedAt,
  });
  return id;
}

/** A refresh-token row; `revoked` null is a live row. */
async function seedRefreshToken(
  userId: string,
  clientId: string,
  revoked: Date | null = null,
): Promise<void> {
  await db.insert(oauthRefreshToken).values({
    id: uuid(),
    token: uuid(),
    userId,
    clientId,
    authorizationCodeId: uuid(),
    scopes: ["openid"],
    createdAt: new Date("2026-11-01T09:00:00.000Z"),
    revoked,
  });
}

const tokenRows = (userId: string, clientId: string) =>
  db
    .select({
      id: oauthRefreshToken.id,
      revoked: oauthRefreshToken.revoked,
    })
    .from(oauthRefreshToken)
    .where(
      and(
        eq(oauthRefreshToken.userId, userId),
        eq(oauthRefreshToken.clientId, clientId),
      ),
    );

const consentRows = (userId: string, clientId: string) =>
  db
    .select({ id: oauthConsent.id })
    .from(oauthConsent)
    .where(
      and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)),
    );

describe("GET /api/v1/connections", () => {
  it("lists one row per client, newest acted first, and never another account's rows", async () => {
    const owner = await freshUser("Connections");
    const other = await freshUser("ConnectionsOther");

    const namedClientId = `named-${uuid()}`;
    // A CIMD client's id is the URL it hosts; an unnamed client is named by it.
    const unnamedClientId = `https://${uuid()}.client.test/client.json`;
    const otherClientId = `other-${uuid()}`;

    const namedId = await seedConsent({
      userId: owner.userId,
      clientId: namedClientId,
      name: "Claude Code",
      createdAt: new Date("2026-11-01T09:00:00.000Z"),
      updatedAt: new Date("2026-11-02T10:00:00.000Z"),
    });
    const unnamedId = await seedConsent({
      userId: owner.userId,
      clientId: unnamedClientId,
      name: null,
      createdAt: new Date("2026-11-01T09:00:00.000Z"),
      updatedAt: new Date("2026-11-01T11:00:00.000Z"),
    });
    const otherId = await seedConsent({
      userId: other.userId,
      clientId: otherClientId,
      name: "Someone Else",
      createdAt: new Date("2026-11-01T09:00:00.000Z"),
      updatedAt: new Date("2026-11-03T10:00:00.000Z"),
    });

    const res = await req("GET", "/api/v1/connections", {
      cookies: owner.cookies,
      // The endpoint comes from the deployment's own environment, not from the
      // request: a foreign `Host` must not move it (in-process the request URL
      // already shares the origin, so only this proves the difference).
      headers: { Host: "evil.example" },
    });
    expect(res.status).toBe(200);
    const body = connectionsReadSchema.parse(await json<unknown>(res));

    expect(body.endpoint).toBe(mcpResource);
    expect(body.connections.map((c) => c.id)).toEqual([namedId, unnamedId]);
    expect(body.connections[0].clientName).toBe("Claude Code");
    expect(body.connections[1].clientName).toBe(unnamedClientId);
    expect(body.connections.some((c) => c.id === otherId)).toBe(false);

    // "Connected" is the approval, "last acted" the guard's touch; the seeded
    // instants must survive the wire unchanged.
    expect(body.connections[0].connectedAt).toEqual({
      seconds: Date.parse("2026-11-01T09:00:00.000Z") / 1000,
      nanoseconds: 0,
    });
    expect(body.connections[0].lastActedAt).toEqual({
      seconds: Date.parse("2026-11-02T10:00:00.000Z") / 1000,
      nanoseconds: 0,
    });
  }, 15000);

  it("answers the unauthorized envelope without a session", async () => {
    const res = await req("GET", "/api/v1/connections");
    expect(res.status).toBe(401);
    expect((await err(res)).code).toBe("unauthorized");
  }, 15000);
});

describe("DELETE /api/v1/connections/:connectionId", () => {
  it("ends that client's access and leaves the session and every other connection working", async () => {
    const owner = await freshUser("ConnectionsRevoke");
    const other = await freshUser("ConnectionsRevokeOther");

    const alphaClientId = `alpha-${uuid()}`;
    const betaClientId = `beta-${uuid()}`;

    const alphaId = await seedConsent({
      userId: owner.userId,
      clientId: alphaClientId,
      name: "Alpha",
      createdAt: new Date("2026-11-01T09:00:00.000Z"),
      updatedAt: new Date("2026-11-01T09:00:00.000Z"),
    });
    // The duplicate the plugin's find-then-create can leave behind: Revoke
    // must clear both, or the guard would still admit the client.
    await seedConsent({
      userId: owner.userId,
      clientId: alphaClientId,
      name: "Alpha",
      createdAt: new Date("2026-11-01T09:00:00.000Z"),
      updatedAt: new Date("2026-11-01T10:00:00.000Z"),
    });
    const betaId = await seedConsent({
      userId: owner.userId,
      clientId: betaClientId,
      name: "Beta",
      createdAt: new Date("2026-11-01T09:00:00.000Z"),
      updatedAt: new Date("2026-11-01T09:00:00.000Z"),
    });
    // Another account approved the same client; its row is not ours to touch.
    await seedConsent({
      userId: other.userId,
      clientId: alphaClientId,
      name: "Alpha",
      createdAt: new Date("2026-11-01T09:00:00.000Z"),
      updatedAt: new Date("2026-11-01T09:00:00.000Z"),
    });

    await seedRefreshToken(owner.userId, alphaClientId);
    // A row a rotation already revoked stays revoked; it is not resurrected.
    const rotatedAt = new Date("2026-11-01T09:30:00.000Z");
    await seedRefreshToken(owner.userId, alphaClientId, rotatedAt);
    await seedRefreshToken(owner.userId, betaClientId);
    await seedRefreshToken(other.userId, alphaClientId);

    const res = await req("DELETE", `/api/v1/connections/${alphaId}`, {
      cookies: owner.cookies,
    });
    expect(res.status).toBe(204);

    // Both consent rows for the pair are gone; the other client's is intact.
    expect(await consentRows(owner.userId, alphaClientId)).toEqual([]);
    expect(await consentRows(owner.userId, betaClientId)).toHaveLength(1);

    // Alpha's live refresh token is revoked; the already-revoked row keeps its
    // original stamp. Beta's stays live.
    const alphaTokens = await tokenRows(owner.userId, alphaClientId);
    expect(alphaTokens.every((t) => t.revoked !== null)).toBe(true);
    expect(
      alphaTokens.find((t) => t.revoked?.getTime() === rotatedAt.getTime()),
    ).toBeDefined();
    const betaTokens = await tokenRows(owner.userId, betaClientId);
    expect(betaTokens[0]?.revoked).toBeNull();

    // The browser session is a different credential: Revoke never touches it.
    const me = await req("GET", "/api/v1/me", { cookies: owner.cookies });
    expect(me.status).toBe(200);

    // Only the other account's approval of Alpha is left anywhere.
    expect(await consentRows(other.userId, alphaClientId)).toHaveLength(1);
    const otherTokens = await tokenRows(other.userId, alphaClientId);
    expect(otherTokens[0]?.revoked).toBeNull();

    // Revoking the same Connection again is a 404: it no longer exists.
    const again = await req("DELETE", `/api/v1/connections/${alphaId}`, {
      cookies: owner.cookies,
    });
    expect(again.status).toBe(404);

    // The surviving Connection still lists.
    const listed = await req("GET", "/api/v1/connections", {
      cookies: owner.cookies,
    });
    const body = connectionsReadSchema.parse(await json<unknown>(listed));
    expect(body.connections.map((c) => c.id)).toEqual([betaId]);
  }, 20000);

  it("answers 404 for a connection id belonging to another account", async () => {
    const owner = await freshUser("ConnectionsForeign");
    const other = await freshUser("ConnectionsForeignOther");
    const clientId = `foreign-${uuid()}`;

    const otherId = await seedConsent({
      userId: other.userId,
      clientId,
      name: "Not Yours",
      createdAt: new Date("2026-11-01T09:00:00.000Z"),
      updatedAt: new Date("2026-11-01T09:00:00.000Z"),
    });

    const res = await req("DELETE", `/api/v1/connections/${otherId}`, {
      cookies: owner.cookies,
    });
    expect(res.status).toBe(404);
    expect((await err(res)).code).toBe("not-found");

    // The refused delete changed nothing.
    expect(await consentRows(other.userId, clientId)).toHaveLength(1);
  }, 15000);
});
