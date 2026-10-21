// The owner administering the invitations, and the invitee's in-app list.
//
//   POST   /collections/{cid}/invitations/{id}/resend   owner: rotate and mail again
//   DELETE /collections/{cid}/invitations/{id}          owner: revoke a pending offer
//   GET    /me/invitations                              the invitee's pending offers
//   POST   /me/invitations/{id}/decline                 the invitee says no, in app
//
// A resend and a revoke act on the same pending row: the token, the expiry and
// the issue time rotate in place, and a row that is no longer pending is a
// conflict either way. Expired pending rows are still the owner's to manage.
//
// The dashboard's list never carries a token — the invitee's list is a list of
// offers, and the link that accepts one only exists in the mail.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { collectionInvitations as invitationsTable } from "@arcula/db";
import type {
  InvitationCreateResponse,
  InvitationInboxEntry,
  InvitationSummary,
} from "@arcula/shared";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db";
import { emailProvider } from "../src/email/provider";
import { hashInvitationToken } from "../src/invitations";
import { err, freshUser, json, req } from "./helpers/api";
import { makeCollection, makeInvitation } from "./helpers/fixtures";
import { linkIn, mailpitText, waitForNewMail } from "./helpers/mailpit";

let owner: { email: string; cookies: string; userId: string };
let mate: { email: string; cookies: string; userId: string };
let cid = "";

/** A second collection the same owner has, for the wrong-collection checks. */
let otherCid = "";

const unknownId = () => crypto.randomUUID();

const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

const resend = (cookies: string, id: string, collectionId = cid) =>
  req("POST", `/api/v1/collections/${collectionId}/invitations/${id}/resend`, {
    cookies,
  });

const revoke = (cookies: string, id: string, collectionId = cid) =>
  req("DELETE", `/api/v1/collections/${collectionId}/invitations/${id}`, {
    cookies,
  });

const createInvitation = (email: string) =>
  req("POST", `/api/v1/collections/${cid}/invitations`, {
    cookies: owner.cookies,
    body: { email },
  });

async function invitationRow(id: string) {
  const [row] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, id));
  return row;
}

/** Move the last issue (and the expiry with it) far enough back that the
 *  60-second cooldown no longer applies. */
async function backdateIssue(id: string, ageMs = 61_000): Promise<void> {
  const createdAt = new Date(Date.now() - ageMs);
  await db
    .update(invitationsTable)
    .set({
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 7 * 86_400_000),
    })
    .where(eq(invitationsTable.id, id));
}

async function tokenFromMail(
  email: string,
  seen: string[] = [],
): Promise<{ token: string; mailId: string }> {
  const mail = await waitForNewMail(email, seen);
  const url = linkIn(await mailpitText(mail.ID));
  return { token: url.pathname.slice("/invite/".length), mailId: mail.ID };
}

beforeAll(async () => {
  owner = await freshUser("OfferOwner");
  mate = await freshUser("OfferMate");
  cid = await makeCollection(owner.userId, {
    name: "Offer Wall",
    isPublic: false,
  });
  otherCid = await makeCollection(owner.userId, {
    name: "Offer Other",
    isPublic: false,
  });
});

afterAll(async () => {
  await closeDb();
});

describe("POST /collections/{cid}/invitations/{id}/resend", () => {
  it("rotates the token, the expiry and the issue time and mails again", async () => {
    const email = uniqueEmail("Resend");
    const created = await json<InvitationCreateResponse>(
      await createInvitation(email),
    );
    const first = await tokenFromMail(email.toLowerCase());
    await backdateIssue(created.invitation.id);

    const res = await resend(owner.cookies, created.invitation.id);
    expect(res.status).toBe(200);
    const body = await json<InvitationCreateResponse>(res);
    expect(body.emailSent).toBe(true);
    // Same row, same offer.
    expect(body.invitation.id).toBe(created.invitation.id);
    expect(body.invitation.status).toBe("pending");

    const row = await invitationRow(created.invitation.id);
    // The issue time moved forward and the expiry followed it: seven days
    // from this send, not the first one.
    expect(row.createdAt.getTime()).toBeGreaterThan(
      created.invitation.createdAt.seconds * 1000,
    );
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(
      7 * 86_400_000,
    );

    const second = await tokenFromMail(email.toLowerCase(), [first.mailId]);
    expect(second.token).not.toBe(first.token);
    expect(row.tokenHash).toBe(hashInvitationToken(second.token));
    expect(row.tokenHash).not.toBe(hashInvitationToken(first.token));

    // Only the freshly mailed link works.
    expect(
      (await req("GET", `/api/v1/invitations/${first.token}`)).status,
    ).toBe(404);
    expect(
      (await req("GET", `/api/v1/invitations/${second.token}`)).status,
    ).toBe(200);
  });

  it("keeps the offer pending and answers emailSent false when the provider fails", async () => {
    const email = uniqueEmail("ResendMailDown");
    const created = await json<InvitationCreateResponse>(
      await createInvitation(email),
    );
    await backdateIssue(created.invitation.id);

    const send = vi
      .spyOn(emailProvider, "send")
      .mockRejectedValueOnce(new Error("provider is down"));
    try {
      const res = await resend(owner.cookies, created.invitation.id);
      expect(res.status).toBe(200);
      expect((await json<InvitationCreateResponse>(res)).emailSent).toBe(false);
      const row = await invitationRow(created.invitation.id);
      expect(row.status).toBe("pending");
      expect(row.resolvedAt).toBeNull();
    } finally {
      send.mockRestore();
    }
  });

  it("conflicts inside the 60-second cooldown and once the invitation is resolved", async () => {
    const email = uniqueEmail("ResendCooldown");
    const created = await json<InvitationCreateResponse>(
      await createInvitation(email),
    );
    // The create was the last send, a moment ago.
    const tooSoon = await resend(owner.cookies, created.invitation.id);
    expect(tooSoon.status).toBe(409);
    expect((await err(tooSoon)).code).toBe("conflict");

    for (const status of ["accepted", "declined", "revoked"] as const) {
      const resolved = await makeInvitation({
        collectionId: cid,
        invitedByUserId: owner.userId,
        email: uniqueEmail(`Resend${status}`),
        status,
      });
      const res = await resend(owner.cookies, resolved.id);
      expect(res.status).toBe(409);
      expect((await err(res)).code).toBe("conflict");
    }
  });

  it("revives an expired pending invitation", async () => {
    const email = uniqueEmail("ResendLapsed");
    const made = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email,
      createdAt: new Date(Date.now() - 8 * 86_400_000),
      expiresAt: new Date(Date.now() - 86_400_000),
    });

    const res = await resend(owner.cookies, made.id);
    expect(res.status).toBe(200);
    const row = await invitationRow(made.id);
    expect(row.status).toBe("pending");
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const fresh = await tokenFromMail(email.toLowerCase());
    expect(fresh.token).not.toBe(made.token);
    expect(
      (await req("GET", `/api/v1/invitations/${fresh.token}`)).status,
    ).toBe(200);
  });

  it("is owner-only, and a foreign invitation is not found", async () => {
    const email = uniqueEmail("ResendRefused");
    const created = await json<InvitationCreateResponse>(
      await createInvitation(email),
    );
    await backdateIssue(created.invitation.id);

    const byMate = await resend(mate.cookies, created.invitation.id);
    expect(byMate.status).toBe(403);
    expect((await err(byMate)).code).toBe("forbidden");

    // Reachable only through its own collection's path.
    const elsewhere = await resend(
      owner.cookies,
      created.invitation.id,
      otherCid,
    );
    expect(elsewhere.status).toBe(404);
    expect((await err(elsewhere)).code).toBe("not-found");
    expect((await invitationRow(created.invitation.id)).status).toBe("pending");
  });
});

describe("DELETE /collections/{cid}/invitations/{id}", () => {
  it("revokes a pending offer and records the resolution", async () => {
    const email = uniqueEmail("Revoke");
    const created = await json<InvitationCreateResponse>(
      await createInvitation(email),
    );
    const token = await tokenFromMail(email.toLowerCase());

    const res = await revoke(owner.cookies, created.invitation.id);
    expect(res.status).toBe(200);
    expect((await json<InvitationSummary>(res)).status).toBe("revoked");

    const row = await invitationRow(created.invitation.id);
    expect(row.status).toBe("revoked");
    expect(row.resolvedAt).not.toBeNull();
    // The mailed link is dead the moment the offer is.
    expect(
      (await req("GET", `/api/v1/invitations/${token.token}`)).status,
    ).toBe(404);
    // A revoked row is no longer the owner's pending list.
    const access = await json<{ invitations: InvitationSummary[] }>(
      await req("GET", `/api/v1/collections/${cid}/access`, {
        cookies: owner.cookies,
      }),
    );
    expect(access.invitations.map((i) => i.id)).not.toContain(
      created.invitation.id,
    );
  });

  it("revokes an expired pending offer too", async () => {
    const made = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: uniqueEmail("RevokeLapsed"),
      createdAt: new Date(Date.now() - 8 * 86_400_000),
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    const res = await revoke(owner.cookies, made.id);
    expect(res.status).toBe(200);
    expect((await invitationRow(made.id)).status).toBe("revoked");
  });

  it("conflicts on a resolved offer and is owner-only", async () => {
    const resolved = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: uniqueEmail("RevokeDone"),
      status: "accepted",
    });
    const res = await revoke(owner.cookies, resolved.id);
    expect(res.status).toBe(409);
    expect((await err(res)).code).toBe("conflict");
    // The history row is untouched.
    expect((await invitationRow(resolved.id)).status).toBe("accepted");

    const pending = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: uniqueEmail("RevokeByMate"),
    });
    const byMate = await revoke(mate.cookies, pending.id);
    expect(byMate.status).toBe(403);
    expect((await invitationRow(pending.id)).status).toBe("pending");
  });
});

describe("GET /me/invitations", () => {
  it("lists the pending, unexpired offers for the signed-in address and never a token", async () => {
    const invitee = await freshUser("OfferInvitee");
    const live = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: invitee.email.toUpperCase(),
      // Stored as given: an address is compared case-insensitively, so a row
      // that was not normalized still reaches its invitee.
      storeEmailAsGiven: true,
    });
    // A lapsed offer (in another collection — one pending row per address
    // per collection), a declined one, and one addressed to somebody else.
    await makeInvitation({
      collectionId: otherCid,
      invitedByUserId: owner.userId,
      email: invitee.email,
      createdAt: new Date(Date.now() - 8 * 86_400_000),
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: invitee.email,
      status: "declined",
    });
    await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: uniqueEmail("OfferInboxOther"),
    });

    const res = await req("GET", "/api/v1/me/invitations", {
      cookies: invitee.cookies,
    });
    expect(res.status).toBe(200);
    const body = await json<InvitationInboxEntry[]>(res);
    // Only the live offer: the lapsed one (another collection), the declined
    // one, and the one addressed to somebody else are all absent.
    expect(body.map((entry) => entry.id)).toEqual([live.id]);

    // Enough to render the card without a second read…
    const [entry] = body;
    expect(entry.collectionName).toBe("Offer Wall");
    expect(entry.status).toBe("pending");
    // …and no secret: neither the hash nor a raw token.
    expect(JSON.stringify(body)).not.toContain(live.token);
    expect(JSON.stringify(body)).not.toContain(hashInvitationToken(live.token));
  });

  it("requires a session", async () => {
    const res = await req("GET", "/api/v1/me/invitations");
    expect(res.status).toBe(401);
  });
});

describe("POST /me/invitations/{id}/decline", () => {
  const decline = (cookies: string, id: string) =>
    req("POST", `/api/v1/me/invitations/${id}/decline`, { cookies });

  it("marks the invitee's own pending offer declined", async () => {
    const invitee = await freshUser("OfferDecline");
    const made = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: invitee.email,
    });

    const res = await decline(invitee.cookies, made.id);
    expect(res.status).toBe(200);
    expect((await json<InvitationSummary>(res)).status).toBe("declined");

    const row = await invitationRow(made.id);
    expect(row.status).toBe("declined");
    expect(row.resolvedAt).not.toBeNull();

    // Declined is history: it is off the invitee's list, and the address can
    // be invited again as a fresh row.
    const body = await json<InvitationInboxEntry[]>(
      await req("GET", "/api/v1/me/invitations", { cookies: invitee.cookies }),
    );
    expect(body.map((entry) => entry.id)).not.toContain(made.id);
  });

  it("answers 404 for another account's, a resolved or an expired offer", async () => {
    const invitee = await freshUser("OfferDecline404");
    const other = await freshUser("OfferDeclineOther");

    const someoneElses = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: uniqueEmail("OfferDeclineOtherAddress"),
    });
    const resolved = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: invitee.email,
      status: "accepted",
    });
    const lapsed = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: invitee.email,
      createdAt: new Date(Date.now() - 8 * 86_400_000),
      expiresAt: new Date(Date.now() - 86_400_000),
    });

    for (const [cookies, id] of [
      [invitee.cookies, someoneElses.id],
      [other.cookies, someoneElses.id],
      [invitee.cookies, resolved.id],
      [invitee.cookies, lapsed.id],
      [invitee.cookies, unknownId()],
    ] as const) {
      const res = await decline(cookies, id);
      expect(res.status).toBe(404);
      expect((await err(res)).code).toBe("not-found");
    }

    // Nothing changed behind the refusals.
    expect((await invitationRow(someoneElses.id)).status).toBe("pending");
    expect((await invitationRow(resolved.id)).status).toBe("accepted");
    expect((await invitationRow(lapsed.id)).status).toBe("pending");
  });

  it("matches the caller's address case-insensitively", async () => {
    const invitee = await freshUser("OfferDeclineCase");
    const made = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: invitee.email.toUpperCase(),
      storeEmailAsGiven: true,
    });

    const res = await decline(invitee.cookies, made.id);
    expect(res.status).toBe(200);
    expect((await invitationRow(made.id)).status).toBe("declined");
  });

  it("requires a session", async () => {
    const made = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: uniqueEmail("OfferDeclineAnon"),
    });
    const res = await req("POST", `/api/v1/me/invitations/${made.id}/decline`);
    expect(res.status).toBe(401);
    expect((await invitationRow(made.id)).status).toBe("pending");
  });
});
