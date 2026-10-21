// The invitation loop, end to end: the owner invites an address, the mail
// carries the link, the invited account previews and accepts or declines, and
// accepting makes it a collaborator.
//
// The sink is the local Mailpit, read through its REST API; the app is driven
// in-process with app.request(). Every address is unique per run and the suite
// never clears the shared inbox — another file is reading it at the same time.
// The raw token is read from the delivered mail, never written to the
// repository or a log.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { controlChars } from "./helpers/html";
import {
  collectionCollaborators as collaboratorsTable,
  collectionInvitations as invitationsTable,
} from "@arcula/db";
import {
  INVITATION_TTL_MS,
  type InvitationCreateResponse,
  type InvitationPreview,
  type InvitationSummary,
} from "@arcula/shared";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../src/db";
import { emailProvider } from "../src/email/provider";
import { hashInvitationToken, mintInvitationToken } from "../src/invitations";
import { err, freshUser, json, req, sessionCookies, uuid } from "./helpers/api";
import { makeCollection } from "./helpers/fixtures";
import {
  linkIn,
  mailpitMessage,
  mailpitText,
  waitForMail,
} from "./helpers/mailpit";

/** The offer's life as the mail states it — the route's own TTL. */
const INVITATION_DAYS = Math.round(INVITATION_TTL_MS / (24 * 60 * 60 * 1000));

type CreateResponse = InvitationCreateResponse;
type PreviewResponse = InvitationPreview;

let owner: { email: string; cookies: string; userId: string };
let collaborator: { email: string; cookies: string; userId: string };
let stranger: { email: string; cookies: string; userId: string };
let cid = "";

const TEST_PASSWORD = "a-long-test-password";

const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

async function signUpAs(
  email: string,
  label: string,
): Promise<{ email: string; cookies: string }> {
  const res = await req("POST", "/api/auth/sign-up/email", {
    body: { email, password: TEST_PASSWORD, name: label },
  });
  expect(res.status).toBe(200);
  return { email, cookies: sessionCookies(res) };
}

const invite = (cookies: string, email: string) =>
  req("POST", `/api/v1/collections/${cid}/invitations`, {
    cookies,
    body: { email },
  });

async function tokenFromMail(email: string): Promise<string> {
  const mail = await waitForMail(email);
  const url = linkIn(await mailpitText(mail.ID));
  expect(url.origin).toBe("http://localhost:3000");
  expect(url.pathname.startsWith("/invite/")).toBe(true);
  return url.pathname.slice("/invite/".length);
}

async function invitationRow(id: string) {
  const [row] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, id));
  return row;
}

async function hasCollaborator(userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: collaboratorsTable.userId })
    .from(collaboratorsTable)
    .where(
      and(
        eq(collaboratorsTable.collectionId, cid),
        eq(collaboratorsTable.userId, userId),
      ),
    );
  return rows.length > 0;
}

/** A row written straight through drizzle, for the states the invite route
 *  cannot create (expired, revoked, declined). */
async function insertInvitation(options: {
  token: string;
  email: string;
  status: "pending" | "accepted" | "declined" | "revoked";
  expiresAt?: Date;
}): Promise<string> {
  const id = uuid();
  const now = new Date();
  await db.insert(invitationsTable).values({
    id,
    collectionId: cid,
    email: options.email.trim().toLowerCase(),
    invitedByUserId: owner.userId,
    tokenHash: hashInvitationToken(options.token),
    status: options.status,
    createdAt: now,
    expiresAt: options.expiresAt ?? new Date(now.getTime() + 86_400_000),
    resolvedAt: options.status === "pending" ? null : now,
  });
  return id;
}

beforeAll(async () => {
  owner = await freshUser("InviteOwner");
  collaborator = await freshUser("InviteMate");
  stranger = await freshUser("InviteOther");
  cid = await makeCollection(owner.userId, {
    name: "Invitation Wall",
    isPublic: false,
  });
  await db.insert(collaboratorsTable).values({
    collectionId: cid,
    userId: collaborator.userId,
  });
});

afterAll(async () => {
  await closeDb();
});

describe("POST /collections/{cid}/invitations", () => {
  it("mails the link and stores only the token hash", async () => {
    const invited = uniqueEmail("Invitee").replace(
      "@example.test",
      "@Example.Test",
    );
    const res = await invite(owner.cookies, invited);
    expect(res.status).toBe(201);

    const body = await json<CreateResponse>(res);
    expect(body.emailSent).toBe(true);
    expect(body.invitation.status).toBe("pending");
    expect(body.invitation.email).toBe(invited.toLowerCase());
    expect(body.invitation.collectionId).toBe(cid);
    expect(body.invitation.resolvedAt).toBeNull();

    // Seven days, computed from the row's own issue time.
    const issued = body.invitation.createdAt.seconds;
    expect(body.invitation.expiresAt.seconds - issued).toBe(7 * 24 * 60 * 60);

    const token = await tokenFromMail(body.invitation.email);
    // The raw token is not on the wire summary.
    expect(JSON.stringify(body)).not.toContain(token);

    const row = await invitationRow(body.invitation.id);
    expect(row.tokenHash).toBe(hashInvitationToken(token));
    expect(row.tokenHash).not.toBe(token);
    expect(row.email).toBe(invited.toLowerCase());
  });

  it("delivers both parts under Arcula's identity, with the branded links", async () => {
    const email = uniqueEmail("Wire");
    const body = await json<CreateResponse>(await invite(owner.cookies, email));
    const token = await tokenFromMail(body.invitation.email);
    const message = await mailpitMessage(
      (await waitForMail(body.invitation.email)).ID,
    );

    expect(message.From.Name).toBe("Arcula");
    expect(message.Subject).toBe(
      "InviteOwner Test invited you to Invitation Wall on Arcula",
    );
    // Both parts, from the same facts: the text twin carries the visible URL.
    expect(message.Text).toContain("Invitation Wall");
    expect(message.Text).toContain(
      `Accept invitation: http://localhost:3000/invite/${token}`,
    );
    expect(message.HTML).toContain(
      'src="http://localhost:3000/arcula-name-logo.png"',
    );
    expect(message.HTML).toContain(
      `href="http://localhost:3000/invite/${token}"`,
    );
    expect(message.HTML).toContain("Accept invitation");
    expect(message.HTML).toContain(`${INVITATION_DAYS} days`);
  });

  it("mails a header-safe, truncated subject and a safely escaped body for a hostile collection name", async () => {
    const hostileName = `Hostile\r\nBcc: evil@example.test <script>alert(1)</script> ${"Z".repeat(50)}`;
    const hostileCid = await makeCollection(owner.userId, {
      name: hostileName,
      isPublic: false,
    });
    const email = uniqueEmail("HostileName");
    const res = await req(
      "POST",
      `/api/v1/collections/${hostileCid}/invitations`,
      { cookies: owner.cookies, body: { email } },
    );
    expect(res.status).toBe(201);

    const message = await mailpitMessage((await waitForMail(email)).ID);
    // Flattened of CR/LF, truncated at 40 including the ellipsis.
    expect(message.Subject).toBe(
      "InviteOwner Test invited you to Hostile Bcc: evil@example.test <script>… on Arcula",
    );
    expect(controlChars(message.Subject)).toEqual([]);
    // The body still carries the whole name, but never as markup.
    expect(message.Text).toContain(hostileName);
    expect(message.HTML).not.toContain("<script>alert(1)</script>");
    expect(message.HTML).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("is owner-only", async () => {
    for (const cookies of [collaborator.cookies, stranger.cookies]) {
      const res = await invite(cookies, uniqueEmail("NotOwner"));
      expect(res.status).toBe(403);
      expect((await err(res)).code).toBe("forbidden");
    }
  });

  it("answers a malformed address with a validation error naming the field", async () => {
    const res = await invite(owner.cookies, "not-an-address");
    expect(res.status).toBe(400);
    const body = await err(res);
    expect(body.code).toBe("validation");
    expect(body.fields?.email).toBeDefined();
  });

  it("conflicts on the owner, a collaborator and an already-pending address", async () => {
    for (const email of [owner.email, collaborator.email]) {
      const res = await invite(owner.cookies, email);
      expect(res.status).toBe(409);
      expect((await err(res)).code).toBe("conflict");
    }

    const email = uniqueEmail("Pending");
    expect((await invite(owner.cookies, email)).status).toBe(201);
    const again = await invite(owner.cookies, email);
    expect(again.status).toBe(409);
    expect((await err(again)).code).toBe("conflict");
  });

  it("reissues an expired pending invitation on the same row", async () => {
    const email = uniqueEmail("ExpiredReissue");
    const oldToken = mintInvitationToken();
    const id = await insertInvitation({
      token: oldToken,
      email,
      status: "pending",
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await invite(owner.cookies, email);
    expect(res.status).toBe(201);
    const body = await json<CreateResponse>(res);
    expect(body.invitation.id).toBe(id);

    const newToken = await tokenFromMail(body.invitation.email);
    expect(newToken).not.toBe(oldToken);
    expect((await req("GET", `/api/v1/invitations/${oldToken}`)).status).toBe(
      404,
    );
    expect((await req("GET", `/api/v1/invitations/${newToken}`)).status).toBe(
      200,
    );
  });

  it("keeps the invitation pending and says emailSent false when the provider fails", async () => {
    const send = vi
      .spyOn(emailProvider, "send")
      .mockRejectedValueOnce(new Error("provider is down"));
    try {
      const res = await invite(owner.cookies, uniqueEmail("MailDown"));
      expect(res.status).toBe(201);
      const body = await json<CreateResponse>(res);
      expect(body.emailSent).toBe(false);

      const row = await invitationRow(body.invitation.id);
      expect(row.status).toBe("pending");
      expect(row.resolvedAt).toBeNull();
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    } finally {
      send.mockRestore();
    }
  });
});

describe("GET /invitations/{token}", () => {
  it("previews the offer publicly without exposing the collection's contents", async () => {
    const email = uniqueEmail("Preview");
    const created = await json<CreateResponse>(
      await invite(owner.cookies, email),
    );
    const token = await tokenFromMail(email);

    const res = await req("GET", `/api/v1/invitations/${token}`);
    expect(res.status).toBe(200);
    const body = await json<PreviewResponse>(res);
    expect(body.collection).toEqual({ id: cid, name: "Invitation Wall" });
    expect(body.inviter).toEqual({ name: "InviteOwner Test" });
    expect(body.email).toBe(email.toLowerCase());
    expect(body.expiresAt.seconds).toBe(created.invitation.expiresAt.seconds);
    expect(body).not.toHaveProperty("description");
    expect(body.collection).not.toHaveProperty("artworks");
  });

  it("answers one uniform 404 for unknown, expired, revoked and declined tokens", async () => {
    const tokens: string[] = [mintInvitationToken()];

    const expiredToken = mintInvitationToken();
    await insertInvitation({
      token: expiredToken,
      email: uniqueEmail("Expired"),
      status: "pending",
      expiresAt: new Date(Date.now() - 1000),
    });
    tokens.push(expiredToken);

    const revokedToken = mintInvitationToken();
    await insertInvitation({
      token: revokedToken,
      email: uniqueEmail("Revoked"),
      status: "revoked",
    });
    tokens.push(revokedToken);

    const declinedToken = mintInvitationToken();
    await insertInvitation({
      token: declinedToken,
      email: uniqueEmail("Declined"),
      status: "declined",
    });
    tokens.push(declinedToken);

    const messages = new Set<string>();
    for (const token of tokens) {
      const res = await req("GET", `/api/v1/invitations/${token}`);
      expect(res.status).toBe(404);
      const body = await err(res);
      expect(body.code).toBe("not-found");
      messages.add(body.message);
    }
    expect(messages.size).toBe(1);
  });
});

describe("POST /invitations/{token}/accept", () => {
  it("makes the matching account a collaborator and consumes the token", async () => {
    const email = uniqueEmail("Accept");
    const created = await json<CreateResponse>(
      await invite(owner.cookies, email),
    );
    const token = await tokenFromMail(email);
    const invited = await signUpAs(email, "Accept Invitee");

    const res = await req("POST", `/api/v1/invitations/${token}/accept`, {
      cookies: invited.cookies,
    });
    expect(res.status).toBe(200);
    expect((await json<{ id: string }>(res)).id).toBe(cid);

    const read = await req("GET", `/api/v1/collections/${cid}`, {
      cookies: invited.cookies,
    });
    expect(read.status).toBe(200);

    const row = await invitationRow(created.invitation.id);
    expect(row.status).toBe("accepted");
    expect(row.resolvedAt).not.toBeNull();

    // Single use: the same link is now one uniform 404, on preview and accept.
    const preview = await req("GET", `/api/v1/invitations/${token}`);
    expect(preview.status).toBe(404);
    const again = await req("POST", `/api/v1/invitations/${token}/accept`, {
      cookies: invited.cookies,
    });
    expect(again.status).toBe(404);
    expect((await err(again)).code).toBe("not-found");
  });

  it("requires a session and refuses a mismatched account with the invited email", async () => {
    const email = uniqueEmail("WrongAccount");
    const created = await json<CreateResponse>(
      await invite(owner.cookies, email),
    );
    const token = await tokenFromMail(email);

    const anonymous = await req("POST", `/api/v1/invitations/${token}/accept`);
    expect(anonymous.status).toBe(401);

    const wrong = await signUpAs(uniqueEmail("SomeoneElse"), "Wrong Account");
    const me = await json<{ id: string }>(
      await req("GET", "/api/v1/me", { cookies: wrong.cookies }),
    );
    const res = await req("POST", `/api/v1/invitations/${token}/accept`, {
      cookies: wrong.cookies,
    });
    expect(res.status).toBe(403);
    const body = await err(res);
    expect(body.code).toBe("forbidden");
    expect(body.details.email).toBe(email.toLowerCase());

    // The refusal changed nothing: the row is still pending and the account
    // did not become a collaborator.
    expect((await invitationRow(created.invitation.id)).status).toBe("pending");
    expect(await hasCollaborator(me.id)).toBe(false);
  });

  it("conflicts when the account already has access", async () => {
    const email = uniqueEmail("AlreadyIn");
    const created = await json<CreateResponse>(
      await invite(owner.cookies, email),
    );
    const token = await tokenFromMail(email);
    const invited = await signUpAs(email, "Already In");
    const me = await json<{ id: string }>(
      await req("GET", "/api/v1/me", { cookies: invited.cookies }),
    );
    await db.insert(collaboratorsTable).values({
      collectionId: cid,
      userId: me.id,
    });

    const res = await req("POST", `/api/v1/invitations/${token}/accept`, {
      cookies: invited.cookies,
    });
    expect(res.status).toBe(409);
    expect((await err(res)).code).toBe("conflict");
    expect((await invitationRow(created.invitation.id)).status).toBe("pending");
  });
});

describe("POST /invitations/{token}/decline", () => {
  it("marks the invitation declined and lets the owner invite the address again", async () => {
    const email = uniqueEmail("Decline");
    const first = await json<CreateResponse>(
      await invite(owner.cookies, email),
    );
    const token = await tokenFromMail(email);
    const invited = await signUpAs(email, "Decline Invitee");

    const anonymous = await req("POST", `/api/v1/invitations/${token}/decline`);
    expect(anonymous.status).toBe(401);

    const wrong = await req("POST", `/api/v1/invitations/${token}/decline`, {
      cookies: stranger.cookies,
    });
    expect(wrong.status).toBe(403);

    const res = await req("POST", `/api/v1/invitations/${token}/decline`, {
      cookies: invited.cookies,
    });
    expect(res.status).toBe(200);
    expect((await json<InvitationSummary>(res)).status).toBe("declined");

    const row = await invitationRow(first.invitation.id);
    expect(row.status).toBe("declined");
    expect(row.resolvedAt).not.toBeNull();

    // A decline is history; inviting again is a fresh row.
    const second = await invite(owner.cookies, email);
    expect(second.status).toBe(201);
    expect((await json<CreateResponse>(second)).invitation.id).not.toBe(
      first.invitation.id,
    );
  });
});
