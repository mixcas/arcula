// The invitation routes:
//
//   POST /collections/{cid}/invitations        owner-only: write the row, mail the link
//   GET  /invitations/{token}                  public preview (no collection contents)
//   POST /invitations/{token}/accept           the invited account joins
//   POST /invitations/{token}/decline          the invited account says no
//
// The raw token is minted here, sent in the mail and never stored: the row
// keeps only its SHA-256 hash. An invalid, expired, revoked, consumed or
// unknown token is one uniform `not-found`, so a link discloses nothing about
// why it stopped working. Acceptance needs both the token from the mail and a
// session whose email matches the invitation — verification is off, so email
// matching alone would let anyone claim an address they do not own (ADR-0004).
//
// The invitation row is committed before the mail is attempted. A provider
// failure answers `emailSent: false` and leaves the offer pending, so the
// owner can resend without re-entering the address.

import { and, eq, sql } from "drizzle-orm";
import {
  collectionCollaborators as collectionCollaboratorsTable,
  collectionInvitations as collectionInvitationsTable,
  user as userTable,
} from "@arcula/db";
import {
  invitationCreateSchema,
  type CollectionRead,
  type InvitationCreatePayload,
  type InvitationCreateResponse,
  type InvitationPreview,
} from "@arcula/shared";
import { Hono } from "hono";
import { loadCollection, requireOwnerCollection } from "../authorize";
import { db } from "../db";
import { clientOrigin } from "../env";
import { ApiError } from "../errors";
import { emailProvider } from "../email/provider";
import { isUniqueViolation, param, parseBody, safeTx, type Tx } from "../http";
import { mintId } from "../ids";
import {
  INVITATION_TTL_MS,
  hashInvitationToken,
  isInvitationUsable,
  mintInvitationToken,
  normalizeEmail,
} from "../invitations";
import {
  displayName,
  serializeCollection,
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

async function loadInvitationByToken(
  token: string,
): Promise<InvitationRow | null> {
  const [row] = await db
    .select()
    .from(collectionInvitationsTable)
    .where(
      eq(collectionInvitationsTable.tokenHash, hashInvitationToken(token)),
    );
  return row ?? null;
}

/** The usable row, or the uniform `404`. */
async function requireUsableInvitation(token: string): Promise<InvitationRow> {
  const row = await loadInvitationByToken(token);
  if (!row || !isInvitationUsable(row)) throw gone();
  return row;
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
  collectionName: string;
  inviterName: string;
  token: string;
}

/** The only place the raw token leaves the process: it is embedded in the
 *  link and nowhere else. */
async function sendInvitationMail(mail: InvitationMail): Promise<void> {
  if (!clientOrigin) {
    throw new Error(
      "CLIENT_ORIGIN is not set; the invitation mail cannot point at the web app.",
    );
  }
  const link = `${clientOrigin}/invite/${mail.token}`;
  await emailProvider.send({
    to: mail.to,
    subject: `${mail.inviterName} invited you to ${mail.collectionName} on Arcula`,
    text: [
      "Hi,",
      "",
      `${mail.inviterName} invited you to collaborate on the collection "${mail.collectionName}" on Arcula.`,
      "",
      `Accept the invitation: ${link}`,
      "",
      "The invitation expires in seven days and can be used once.",
      "If you were not expecting this, ignore this email.",
    ].join("\n"),
  });
}

// POST — owner-only. The conflicts are checked in this order: the owner's own
// address, an existing collaborator, then a live pending invitation. A
// resolved row (accepted, declined, revoked) does not block a fresh one; an
// expired pending row is reissued on the same row, because the partial unique
// index keeps it in the pending slot and its old link is already dead.
invitationRoutes.post(
  "/collections/:collectionId/invitations",
  requireSession,
  async (c) => {
    const collection = await requireOwnerCollection(
      c,
      param(c, "collectionId"),
    );
    const user = c.get("user");
    const payload: InvitationCreatePayload = await parseBody(
      c,
      invitationCreateSchema,
    );
    const email = normalizeEmail(payload.email);

    if (normalizeEmail(user.email) === email) {
      throw conflict("You already own this collection");
    }

    const [account] = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(sql`lower(${userTable.email}) = ${email}`);
    if (account) {
      const [membership] = await db
        .select({ userId: collectionCollaboratorsTable.userId })
        .from(collectionCollaboratorsTable)
        .where(
          and(
            eq(collectionCollaboratorsTable.collectionId, collection.id),
            eq(collectionCollaboratorsTable.userId, account.id),
          ),
        );
      if (membership) {
        throw conflict("That account already has access to this collection");
      }
    }

    const [pending] = await db
      .select()
      .from(collectionInvitationsTable)
      .where(
        and(
          eq(collectionInvitationsTable.collectionId, collection.id),
          sql`lower(${collectionInvitationsTable.email}) = ${email}`,
          eq(collectionInvitationsTable.status, "pending"),
        ),
      );
    const now = new Date();
    if (pending && isInvitationUsable(pending, now)) {
      throw conflict("An invitation for that address is already pending");
    }

    const token = mintInvitationToken();
    const row: InvitationRow = {
      id: pending?.id ?? mintId(),
      collectionId: collection.id,
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
          .update(collectionInvitationsTable)
          .set(row)
          .where(eq(collectionInvitationsTable.id, pending.id));
      } else {
        await db.insert(collectionInvitationsTable).values(row);
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
        collectionName: collection.name,
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

// GET — public preview. Only the collection's name, the inviter's display name
// and the invited address; the works inside are not this route's business, and
// the inviter's own email stays out of an anonymous response.
invitationRoutes.get("/invitations/:token", async (c) => {
  const invitation = await requireUsableInvitation(param(c, "token"));
  const collection = await loadCollection(invitation.collectionId);
  const [inviter] = await db
    .select({ id: userTable.id, name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, invitation.invitedByUserId));
  if (!collection || !inviter) throw gone();

  const preview: InvitationPreview = {
    collection: { id: collection.id, name: collection.name },
    inviter: {
      name: inviter.name?.trim() ? inviter.name.trim() : "An Arcula member",
    },
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

    const collection = await loadCollection(invitation.collectionId);
    if (!collection) throw gone();
    if (collection.userId === user.id) {
      throw conflict("You already have access to this collection");
    }
    const [membership] = await db
      .select({ userId: collectionCollaboratorsTable.userId })
      .from(collectionCollaboratorsTable)
      .where(
        and(
          eq(collectionCollaboratorsTable.collectionId, collection.id),
          eq(collectionCollaboratorsTable.userId, user.id),
        ),
      );
    if (membership) {
      throw conflict("You already have access to this collection");
    }

    const now = new Date();
    await safeTx(async (tx: Tx) => {
      // The guard is part of the update, so a second acceptance of the same
      // token cannot insert a second membership.
      const accepted = await tx
        .update(collectionInvitationsTable)
        .set({ status: "accepted", resolvedAt: now })
        .where(
          and(
            eq(collectionInvitationsTable.id, invitation.id),
            eq(collectionInvitationsTable.status, "pending"),
          ),
        )
        .returning({ id: collectionInvitationsTable.id });
      if (accepted.length === 0) throw gone();
      const added = await tx
        .insert(collectionCollaboratorsTable)
        .values({
          collectionId: collection.id,
          userId: user.id,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning({ userId: collectionCollaboratorsTable.userId });
      // A race with another membership grant: nothing was added, so the
      // accepted status must roll back with it.
      if (added.length === 0) {
        throw conflict("You already have access to this collection");
      }
    });

    const read: CollectionRead = serializeCollection(collection);
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
      .update(collectionInvitationsTable)
      .set({ status: "declined", resolvedAt: new Date() })
      .where(
        and(
          eq(collectionInvitationsTable.id, invitation.id),
          eq(collectionInvitationsTable.status, "pending"),
        ),
      )
      .returning();
    if (!declined) throw gone();
    return c.json(serializeInvitation(declined));
  },
);
