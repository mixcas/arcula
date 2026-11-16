// The invitation routes:
//
//   POST   /catalogues/{cid}/invitations                  owner: write the row, mail the link
//   POST   /catalogues/{cid}/invitations/{id}/resend      owner: rotate the offer, mail it again
//   DELETE /catalogues/{cid}/invitations/{id}             owner: revoke a pending offer
//   GET    /invitations/{token}                            public preview (no catalogue contents)
//   POST   /invitations/{token}/accept                     the invited account joins
//   POST   /invitations/{token}/decline                    the invited account says no
//   GET    /me/invitations                                 the invitee's pending offers
//   POST   /me/invitations/{id}/decline                    the invitee says no, in app
//
// The raw token is minted here, sent in the mail and never stored: the row
// keeps only its SHA-256 hash. An invalid, expired, revoked, consumed or
// unknown token is one uniform `not-found`, so a link discloses nothing about
// why it stopped working. Acceptance needs both the token from the mail and a
// session whose email matches the invitation — verification is off, so email
// matching alone would let anyone claim an address they do not own (ADR-0004).
//
// Resend and revoke act on the same pending row the owner sees in the access
// read: resend rotates the token, the expiry and the issue time in place
// (which is also what the 60-second cooldown reads), revoke records the
// resolution. Both conflict on a row that is no longer pending. An expired
// pending row is still the owner's to resend or revoke — expiry is computed
// from `expiresAt`, never stored as a status, so "lapsed" is not a state the
// row can leave.
//
// The in-app list shows an offer and declines it, and can never accept one:
// the token in the mail is the proof of inbox control. Its decline answers
// `not-found` for every reason other than "this is your live offer", so an id
// discloses nothing to an account it is not addressed to.
//
// The invitation row is committed before the mail is attempted. A provider
// failure answers `emailSent: false` and leaves the offer pending, so the
// owner can resend without re-entering the address.
//

import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import {
  catalogueCollaborators as catalogueCollaboratorsTable,
  catalogueInvitations as catalogueInvitationsTable,
  catalogues as cataloguesTable,
  user as userTable,
} from "@arcula/db";
import {
  invitationCreateSchema,
  normalizeEmail,
  type CatalogueRead,
  type InvitationCreatePayload,
  type InvitationCreateResponse,
  type InvitationInboxEntry,
  type InvitationPreview,
} from "@arcula/shared";
import { Hono } from "hono";
import { loadCatalogue, requireOwnerCatalogue } from "../authorize";
import { db } from "../db";
import { invitationMail } from "../email/compose";
import { replyToConfigured } from "../env";
import { clientLink } from "../email/links";
import { emailProvider } from "../email/provider";
import { ApiError } from "../errors";
import { isUniqueViolation, param, parseBody, safeTx, type Tx } from "../http";
import { mintId } from "../ids";
import {
  INVITATION_TTL_MS,
  hashInvitationToken,
  isInvitationResendable,
  isInvitationUsable,
  mintInvitationToken,
  resendCutoff,
} from "../invitations";
import {
  displayName,
  inviterDisplayName,
  serializeCatalogue,
  serializeInvitation,
  wireTimestamp,
  type InvitationRow,
} from "../serialize";
import { requireSession } from "../session";

export const invitationRoutes = new Hono();

/** The one answer for every link that cannot be used, whatever the reason. */
const gone = (): ApiError =>
  new ApiError("not-found", "The invitation does not exist");

const conflict = (message: string): ApiError =>
  new ApiError("conflict", message);

/** Why a resend was refused, read off the row as it stands: a cooldown still
 *  ticking and an offer that has resolved are different answers. */
const resendConflict = (invitation: Pick<InvitationRow, "status">): ApiError =>
  conflict(
    invitation.status === "pending"
      ? "This invitation was sent less than a minute ago; try again shortly."
      : "This invitation is no longer pending",
  );

async function loadInvitationByToken(
  token: string,
): Promise<InvitationRow | null> {
  const [row] = await db
    .select()
    .from(catalogueInvitationsTable)
    .where(eq(catalogueInvitationsTable.tokenHash, hashInvitationToken(token)));
  return row ?? null;
}

/** The usable row, or the uniform `404`. */
async function requireUsableInvitation(token: string): Promise<InvitationRow> {
  const row = await loadInvitationByToken(token);
  if (!row || !isInvitationUsable(row)) throw gone();
  return row;
}

/** One invitation of this catalogue by id. The catalogue is part of the
 *  lookup, so an id from another catalogue is simply not found here. */
async function loadCatalogueInvitation(
  catalogueId: string,
  invitationId: string,
): Promise<InvitationRow | null> {
  const [row] = await db
    .select()
    .from(catalogueInvitationsTable)
    .where(
      and(
        eq(catalogueInvitationsTable.id, invitationId),
        eq(catalogueInvitationsTable.catalogueId, catalogueId),
      ),
    );
  return row ?? null;
}

/**
 * The inbox proof: the signed-in account's address must be the invited one.
 * Email matching alone is never acceptance — the token from the mail is the
 * other half — but a mismatch is refused before the token can be consumed.
 */
function requireInvitedEmail(
  invitation: InvitationRow,
  userEmail: string,
): void {
  if (normalizeEmail(userEmail) !== invitation.email) {
    throw new ApiError(
      "forbidden",
      "This invitation is for a different email address",
      // The invite page's switch-account state reads the address from here.
      { details: { email: invitation.email } },
    );
  }
}

interface InvitationMail {
  to: string;
  catalogueName: string;
  inviterName: string;
  token: string;
}

/** The only place the raw token leaves the process: it is embedded in the
 *  link and nowhere else. Create and resend both call this, so the mail's
 *  identity and layout have one definition. */
async function sendInvitationMail(mail: InvitationMail): Promise<void> {
  const url = clientLink(`/invite/${mail.token}`);
  await emailProvider.send(
    invitationMail({
      to: mail.to,
      inviterName: mail.inviterName,
      catalogueName: mail.catalogueName,
      url,
      // The footer only offers a reply when one lands on a person.
      hasReplyPath: replyToConfigured,
    }),
  );
}

// POST — owner-only. The conflicts are checked in this order: the owner's own
// address, an existing collaborator, then a live pending invitation. A
// resolved row (accepted, declined, revoked) does not block a fresh one; an
// expired pending row is reissued on the same row, because the partial unique
// index keeps it in the pending slot and its old link is already dead.
invitationRoutes.post(
  "/catalogues/:catalogueId/invitations",
  requireSession,
  async (c) => {
    const catalogue = await requireOwnerCatalogue(c, param(c, "catalogueId"));
    const user = c.get("user");
    const payload: InvitationCreatePayload = await parseBody(
      c,
      invitationCreateSchema,
    );
    const email = normalizeEmail(payload.email);

    if (normalizeEmail(user.email) === email) {
      throw conflict("You already own this catalogue");
    }

    const [account] = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(sql`lower(${userTable.email}) = ${email}`);
    if (account) {
      const [membership] = await db
        .select({ userId: catalogueCollaboratorsTable.userId })
        .from(catalogueCollaboratorsTable)
        .where(
          and(
            eq(catalogueCollaboratorsTable.catalogueId, catalogue.id),
            eq(catalogueCollaboratorsTable.userId, account.id),
          ),
        );
      if (membership) {
        throw conflict("That account already has access to this catalogue");
      }
    }

    const [pending] = await db
      .select()
      .from(catalogueInvitationsTable)
      .where(
        and(
          eq(catalogueInvitationsTable.catalogueId, catalogue.id),
          sql`lower(${catalogueInvitationsTable.email}) = ${email}`,
          eq(catalogueInvitationsTable.status, "pending"),
        ),
      );
    const now = new Date();
    if (pending && isInvitationUsable(pending, now)) {
      throw conflict("An invitation for that address is already pending");
    }

    const token = mintInvitationToken();
    const row: InvitationRow = {
      id: pending?.id ?? mintId(),
      catalogueId: catalogue.id,
      email,
      invitedByUserId: user.id,
      tokenHash: hashInvitationToken(token),
      status: "pending",
      createdAt: now,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      resolvedAt: null,
    };
    try {
      if (pending) {
        await db
          .update(catalogueInvitationsTable)
          .set(row)
          .where(eq(catalogueInvitationsTable.id, pending.id));
      } else {
        await db.insert(catalogueInvitationsTable).values(row);
      }
    } catch (error) {
      // The partial unique index is the race-safe half of the pending check.
      if (isUniqueViolation(error)) {
        throw conflict("An invitation for that address is already pending");
      }
      throw error;
    }

    let emailSent = true;
    try {
      await sendInvitationMail({
        to: email,
        catalogueName: catalogue.name,
        inviterName: displayName(user.name, user.email),
        token,
      });
    } catch {
      // The row is the durable fact; a provider outage is reported, not fatal.
      emailSent = false;
    }

    const response: InvitationCreateResponse = {
      invitation: serializeInvitation(row),
      emailSent,
    };
    return c.json(response, 201);
  },
);

// POST …/{id}/resend — owner-only. The same pending row is reissued: a fresh
// token, a fresh seven-day expiry and a fresh issue time, which is both what
// the link and the 60-second cooldown read. An expired pending row is exactly
// the offer a resend exists for, so liveness is not part of the check.
invitationRoutes.post(
  "/catalogues/:catalogueId/invitations/:invitationId/resend",
  requireSession,
  async (c) => {
    const catalogue = await requireOwnerCatalogue(c, param(c, "catalogueId"));
    const invitation = await loadCatalogueInvitation(
      catalogue.id,
      param(c, "invitationId"),
    );
    if (!invitation) throw gone();

    const now = new Date();
    if (!isInvitationResendable(invitation, now))
      throw resendConflict(invitation);

    const token = mintInvitationToken();
    // The status and the cooldown ride in the WHERE too: two resends racing
    // each other cannot both rotate the row, and only one of them mails.
    const [rotated] = await db
      .update(catalogueInvitationsTable)
      .set({
        tokenHash: hashInvitationToken(token),
        createdAt: now,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      })
      .where(
        and(
          eq(catalogueInvitationsTable.id, invitation.id),
          eq(catalogueInvitationsTable.status, "pending"),
          lte(catalogueInvitationsTable.createdAt, resendCutoff(now)),
        ),
      )
      .returning();
    if (!rotated) {
      // A resend raced this one and rotated the row first (or resolved it):
      // answer for the row as it now stands.
      const current = await loadCatalogueInvitation(
        catalogue.id,
        invitation.id,
      );
      throw resendConflict(current ?? invitation);
    }

    const user = c.get("user");
    let emailSent = true;
    try {
      await sendInvitationMail({
        to: rotated.email,
        catalogueName: catalogue.name,
        inviterName: displayName(user.name, user.email),
        token,
      });
    } catch {
      emailSent = false;
    }

    const response: InvitationCreateResponse = {
      invitation: serializeInvitation(rotated),
      emailSent,
    };
    return c.json(response);
  },
);

// DELETE — owner-only. Revoking keeps the row as history: the status says how
// the offer ended, and the mailed link is dead the moment it is not pending.
invitationRoutes.delete(
  "/catalogues/:catalogueId/invitations/:invitationId",
  requireSession,
  async (c) => {
    const catalogue = await requireOwnerCatalogue(c, param(c, "catalogueId"));
    const invitation = await loadCatalogueInvitation(
      catalogue.id,
      param(c, "invitationId"),
    );
    if (!invitation) throw gone();

    const [revoked] = await db
      .update(catalogueInvitationsTable)
      .set({ status: "revoked", resolvedAt: new Date() })
      .where(
        and(
          eq(catalogueInvitationsTable.id, invitation.id),
          eq(catalogueInvitationsTable.status, "pending"),
        ),
      )
      .returning();
    if (!revoked) throw conflict("This invitation is no longer pending");
    return c.json(serializeInvitation(revoked));
  },
);

// GET — public preview. Only the catalogue's name, the inviter's display name
// and the invited address; the works inside are not this route's business, and
// the inviter's own email stays out of an anonymous response.
invitationRoutes.get("/invitations/:token", async (c) => {
  const invitation = await requireUsableInvitation(param(c, "token"));
  const catalogue = await loadCatalogue(invitation.catalogueId);
  const [inviter] = await db
    .select({ id: userTable.id, name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, invitation.invitedByUserId));
  if (!catalogue || !inviter) throw gone();

  const preview: InvitationPreview = {
    catalogue: { id: catalogue.id, name: catalogue.name },
    inviter: { name: inviterDisplayName(inviter.name) },
    email: invitation.email,
    expiresAt: wireTimestamp(invitation.expiresAt),
  };
  return c.json(preview);
});

// POST — the session's email must match the invited address. The account
// already having access is a conflict, not a silent no-op. The membership row
// and the accepted status land in one transaction.
invitationRoutes.post(
  "/invitations/:token/accept",
  requireSession,
  async (c) => {
    const invitation = await requireUsableInvitation(param(c, "token"));
    const user = c.get("user");
    requireInvitedEmail(invitation, user.email);

    const catalogue = await loadCatalogue(invitation.catalogueId);
    if (!catalogue) throw gone();
    if (catalogue.userId === user.id) {
      throw conflict("You already have access to this catalogue");
    }
    const [membership] = await db
      .select({ userId: catalogueCollaboratorsTable.userId })
      .from(catalogueCollaboratorsTable)
      .where(
        and(
          eq(catalogueCollaboratorsTable.catalogueId, catalogue.id),
          eq(catalogueCollaboratorsTable.userId, user.id),
        ),
      );
    if (membership) {
      throw conflict("You already have access to this catalogue");
    }

    const now = new Date();
    await safeTx(async (tx: Tx) => {
      // The guard is part of the update, so a second acceptance of the same
      // token cannot insert a second membership.
      const accepted = await tx
        .update(catalogueInvitationsTable)
        .set({ status: "accepted", resolvedAt: now })
        .where(
          and(
            eq(catalogueInvitationsTable.id, invitation.id),
            eq(catalogueInvitationsTable.status, "pending"),
          ),
        )
        .returning({ id: catalogueInvitationsTable.id });
      if (accepted.length === 0) throw gone();
      const added = await tx
        .insert(catalogueCollaboratorsTable)
        .values({
          catalogueId: catalogue.id,
          userId: user.id,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning({ userId: catalogueCollaboratorsTable.userId });
      // A race with another membership grant: nothing was added, so the
      // accepted status must roll back with it.
      if (added.length === 0) {
        throw conflict("You already have access to this catalogue");
      }
    });

    // The caller is a member now, so this is a member read: it may say
    // whether the catalogue is protected.
    const read: CatalogueRead = serializeCatalogue(catalogue, {
      audience: "member",
    });
    return c.json(read);
  },
);

// POST — the invited account says no. Declining is history, so the same
// address can be invited again as a fresh row.
invitationRoutes.post(
  "/invitations/:token/decline",
  requireSession,
  async (c) => {
    const invitation = await requireUsableInvitation(param(c, "token"));
    const user = c.get("user");
    requireInvitedEmail(invitation, user.email);

    const [declined] = await db
      .update(catalogueInvitationsTable)
      .set({ status: "declined", resolvedAt: new Date() })
      .where(
        and(
          eq(catalogueInvitationsTable.id, invitation.id),
          eq(catalogueInvitationsTable.status, "pending"),
        ),
      )
      .returning();
    if (!declined) throw gone();
    return c.json(serializeInvitation(declined));
  },
);

// GET — the invitee's offers. Pending and unexpired only, addressed to the
// signed-in account's own address: a lapsed offer is not an offer, and a
// declined one is history. The catalogue's name and the inviter's display
// name ride along so the card can name both — an invitee is not a member yet,
// so there is no catalogue read to make, and the inviter's email stays out of
// it. No token, and no invitation hash, ever leaves here.
invitationRoutes.get("/me/invitations", requireSession, async (c) => {
  const user = c.get("user");
  const rows = await db
    .select({
      invitation: catalogueInvitationsTable,
      catalogueName: cataloguesTable.name,
      // The inviter is named, never addressed: the account may have no display
      // name, and the invitee is not entitled to the inviter's email. A left
      // join keeps a live offer visible even if its inviter's row is gone.
      inviterName: userTable.name,
    })
    .from(catalogueInvitationsTable)
    .innerJoin(
      cataloguesTable,
      eq(cataloguesTable.id, catalogueInvitationsTable.catalogueId),
    )
    .leftJoin(
      userTable,
      eq(userTable.id, catalogueInvitationsTable.invitedByUserId),
    )
    .where(
      and(
        sql`lower(${catalogueInvitationsTable.email}) = ${normalizeEmail(user.email)}`,
        eq(catalogueInvitationsTable.status, "pending"),
        gt(catalogueInvitationsTable.expiresAt, new Date()),
        // A deleted catalogue has no live offers. The delete's transaction
        // already withdrew them; this filter is the defence for any row
        // written by a path that did not go through the owner check.
        isNull(cataloguesTable.deletedAt),
      ),
    )
    .orderBy(desc(catalogueInvitationsTable.createdAt));

  const inbox: InvitationInboxEntry[] = rows.map(
    ({ invitation, catalogueName, inviterName }) => ({
      ...serializeInvitation(invitation),
      catalogueName,
      inviterName: inviterDisplayName(inviterName),
    }),
  );
  return c.json(inbox);
});

// POST — the invitee says no without the mail's token. Only their own live
// offer exists as far as this route is concerned: another account's row, a
// resolved one, an expired one and an unknown id are the same `404`, so the
// id discloses nothing. Accepting stays the mail's job (ADR-0004).
invitationRoutes.post(
  "/me/invitations/:invitationId/decline",
  requireSession,
  async (c) => {
    const user = c.get("user");
    const email = normalizeEmail(user.email);
    const [invitation] = await db
      .select()
      .from(catalogueInvitationsTable)
      .where(eq(catalogueInvitationsTable.id, param(c, "invitationId")));
    // The address is compared in its normalized form on both sides, the same
    // rule the inbox lists by: a row stored un-normalized is still this
    // account's offer.
    if (
      !invitation ||
      normalizeEmail(invitation.email) !== email ||
      !isInvitationUsable(invitation)
    ) {
      throw gone();
    }

    const [declined] = await db
      .update(catalogueInvitationsTable)
      .set({ status: "declined", resolvedAt: new Date() })
      .where(
        and(
          eq(catalogueInvitationsTable.id, invitation.id),
          eq(catalogueInvitationsTable.status, "pending"),
        ),
      )
      .returning();
    if (!declined) throw gone();
    return c.json(serializeInvitation(declined));
  },
);
