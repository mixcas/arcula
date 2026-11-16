// The access-administration routes:
//
//   GET    /catalogues/{cid}/access                         a member's view of who has access
//   DELETE /catalogues/{cid}/collaborators/{userId}         owner: remove somebody
//   DELETE /catalogues/{cid}/collaborators/me               collaborator: leave
//   POST   /catalogues/{cid}/transfer                       owner: transfer the catalogue
//
// The owner and every collaborator read the access view; nobody else does. It
// answers the caller's role, the owner and the collaborators — and, for the
// owner alone, the pending invitations, expired ones included. That split is
// the whole design (ADR-0004): the invitation list is an administrative view
// of addresses and expiry, while the people who have access are a fact every
// member of the catalogue already works with.
//
// The owner is not in `collaborators`: `catalogues.userId` is the one owner
// fact, never a row.
//
// The access card and the settings screen read their role from here, not from
// the dashboard list: a list row's `role` is a dashboard badge, and an
// administrative screen has to ask the catalogue itself.
//
// Access can end. Removal is the owner's (a collaborator attempting it is
// refused, even on themselves); leaving is the collaborator's own, and the
// owner is refused because a catalogue is never left without an owner —
// transfer first. Both delete the membership row and nothing that is saved:
// the works the departing account recorded stay in the catalogue, with their
// final objects, and the account is a visitor from its next request on. Only
// its unsaved uploads for that one catalogue are discarded — its staging
// prefix, emptied best effort. A storage failure does not fail the action; the
// seven-day staging lifecycle is the backstop.
//
// Transfer is the owner's, and it is immediate. The recipient must already be
// a collaborator (never a fresh invitation): one transaction moves the owner
// column, mirrors the new owner onto every artwork, removes the recipient's
// membership row and inserts the previous owner's. `mediaNamespaceId` is fixed
// at creation and is what every final object key is built with, so no object
// moves and every saved URL keeps serving the same bytes. The previous owner
// stays a collaborator, and the notice to the new owner is attempted only
// after the commit: a provider failure answers `emailSent: false` and does not
// undo the transfer. The recipient's tier is never checked — receiving a
// catalogue may take an account over its cap.
//
// The two removal paths differ only in who may ask and in which account is
// named — the deletion and the cleanup are one helper each. `/me` is
// registered before `/:userId` so the literal segment is never read as an
// account id.
//

import { and, asc, eq, ne } from "drizzle-orm";
import {
  artworks as artworksTable,
  catalogueCollaborators as catalogueCollaboratorsTable,
  catalogueInvitations as catalogueInvitationsTable,
  catalogues as cataloguesTable,
  user as userTable,
} from "@arcula/db";
import {
  catalogueSlug,
  catalogueTransferSchema,
  type CatalogueAccess,
  type CatalogueTransferPayload,
  type CatalogueTransferResponse,
} from "@arcula/shared";
import { Hono } from "hono";
import { requireMemberCatalogue, requireOwnerCatalogue } from "../authorize";
import { db } from "../db";
import { ownershipTransferMail } from "../email/compose";
import { clientLink } from "../email/links";
import { emailProvider } from "../email/provider";
import { ApiError } from "../errors";
import { param, parseBody, safeTx } from "../http";
import { mediaNamespaceOf, stagedCataloguePrefix } from "../media/keys";
import { requireSession } from "../session";
import {
  displayName,
  serializeInvitation,
  serializeMember,
} from "../serialize";
import { deleteObject, listObjects } from "../storage";

export const accessRoutes = new Hono();

/** The columns a person is named by, in the queries below. */
const memberColumns = {
  id: userTable.id,
  name: userTable.name,
  email: userTable.email,
  // Read for the transfer notice's greeting; the access read does not
  // serialize it.
  firstName: userTable.firstName,
};

accessRoutes.get(
  "/catalogues/:catalogueId/access",
  requireSession,
  async (c) => {
    const catalogue = await requireMemberCatalogue(c, param(c, "catalogueId"));
    const user = c.get("user");
    // Membership is already proven, so the role is the owner column and
    // nothing else: no second membership query.
    const role = catalogue.userId === user.id ? "owner" : "collaborator";

    const [owner] = await db
      .select(memberColumns)
      .from(userTable)
      .where(eq(userTable.id, catalogue.userId));
    // The catalogue's owner column is not a foreign key; a dangling owner is
    // a corrupt row, not a permission question.
    if (!owner) {
      throw new ApiError("internal", "The catalogue's owner does not exist");
    }

    // `collaborators` is everyone except the owner: the owner fact is the
    // column, so a stray row naming the owner (a hand-written seed, a former
    // transfer's leftover) must not list them twice.
    const collaborators = await db
      .select(memberColumns)
      .from(catalogueCollaboratorsTable)
      .innerJoin(
        userTable,
        eq(userTable.id, catalogueCollaboratorsTable.userId),
      )
      .where(
        and(
          eq(catalogueCollaboratorsTable.catalogueId, catalogue.id),
          ne(catalogueCollaboratorsTable.userId, catalogue.userId),
        ),
      )
      .orderBy(asc(catalogueCollaboratorsTable.createdAt));

    const access: CatalogueAccess = {
      role,
      owner: serializeMember(owner),
      collaborators: collaborators.map(serializeMember),
    };

    if (role === "owner") {
      // Pending only — a resolved row is history. An expired row is still
      // `pending` and still the owner's business: it can be resent or
      // revoked, and the card reads its liveness off `expiresAt`.
      const invitations = await db
        .select()
        .from(catalogueInvitationsTable)
        .where(
          and(
            eq(catalogueInvitationsTable.catalogueId, catalogue.id),
            eq(catalogueInvitationsTable.status, "pending"),
          ),
        )
        .orderBy(asc(catalogueInvitationsTable.createdAt));
      access.invitations = invitations.map(serializeInvitation);
    }

    return c.json(access);
  },
);

/**
 * Delete the account's membership row: the access fact. Both callers have
 * already named the account they may act on, so a miss is not a permission
 * question — it is the row having been removed by a request that raced this
 * one. Returns whether this request took it.
 */
async function deleteMembership(
  catalogueId: string,
  userId: string,
): Promise<boolean> {
  const [deleted] = await db
    .delete(catalogueCollaboratorsTable)
    .where(
      and(
        eq(catalogueCollaboratorsTable.catalogueId, catalogueId),
        eq(catalogueCollaboratorsTable.userId, userId),
      ),
    )
    .returning({ userId: catalogueCollaboratorsTable.userId });
  return deleted !== undefined;
}

/**
 * Empty the account's staging prefix for this catalogue — their unsaved
 * uploads for it, and nothing that was saved (a saved entry's staged objects
 * are already gone; its final objects live under the catalogue's namespace).
 *
 * Best effort by contract: a storage failure must not fail the removal. The
 * seven-day staging lifecycle is the backstop for whatever this could not
 * reach. The whole prefix is one uploader's space in one catalogue, so unlike
 * a single entry's discard there is no sibling entry id to tell apart.
 */
async function discardStagedUploads(
  catalogueId: string,
  userId: string,
): Promise<void> {
  let keys: string[];
  try {
    keys = await listObjects(stagedCataloguePrefix(userId, catalogueId));
  } catch {
    return; // Nothing listed, nothing to discard — see above.
  }
  for (const key of keys) {
    try {
      await deleteObject(key);
    } catch {
      // One object the store would not take is that object's problem: the
      // rest of the prefix is still the departing account's leftovers.
    }
  }
}

// DELETE …/collaborators/me — the collaborator's own exit. The owner cannot
// take it: a catalogue is never left without one, so the owner transfers
// first. Refusals are the membership check's (`403` for a non-member, `404`
// for a missing catalogue) and this handler's one conflict.
accessRoutes.delete(
  "/catalogues/:catalogueId/collaborators/me",
  requireSession,
  async (c) => {
    const catalogue = await requireMemberCatalogue(c, param(c, "catalogueId"));
    const user = c.get("user");
    if (catalogue.userId === user.id) {
      throw new ApiError(
        "conflict",
        "Transfer the catalogue before leaving it",
      );
    }

    await deleteMembership(catalogue.id, user.id);
    await discardStagedUploads(catalogue.id, user.id);
    return c.json({ left: true });
  },
);

// DELETE …/collaborators/{userId} — the owner's removal. A collaborator
// attempting it is refused by the owner-only check, themselves included: a
// collaborator leaves through /me. The owner is not a collaborator row, so
// naming them is a conflict rather than a no-op, exactly as naming an account
// that never had access is.
accessRoutes.delete(
  "/catalogues/:catalogueId/collaborators/:userId",
  requireSession,
  async (c) => {
    const catalogue = await requireOwnerCatalogue(c, param(c, "catalogueId"));
    const targetId = param(c, "userId");
    if (targetId === catalogue.userId) {
      throw new ApiError(
        "conflict",
        "The catalogue's owner is not a collaborator",
      );
    }

    if (!(await deleteMembership(catalogue.id, targetId))) {
      // The row is the access fact: no row is "this account does not have
      // access", which is what a stale access card needs to hear.
      throw new ApiError(
        "conflict",
        "That account does not have access to this catalogue",
      );
    }

    // The row went first, so the access has already ended by the time the
    // objects are reached: the cleanup is the residue, never the refusal.
    await discardStagedUploads(catalogue.id, targetId);
    return c.json({ removed: true });
  },
);

interface TransferMail {
  to: string;
  firstName?: string | null;
  catalogueId: string;
  catalogueName: string;
  previousOwnerName: string;
}

/** The notice to the account that now owns the catalogue. The link lands on
 *  the manage page — the new owner's first job is there, not on the public
 *  view. The copy is the composer's; this function only builds the link. */
async function sendTransferMail(mail: TransferMail): Promise<void> {
  const link = clientLink(
    `/manage/catalogue/${catalogueSlug(mail.catalogueName, mail.catalogueId)}`,
  );
  await emailProvider.send(
    ownershipTransferMail({
      to: mail.to,
      firstName: mail.firstName,
      catalogueName: mail.catalogueName,
      previousOwnerName: mail.previousOwnerName,
      url: link,
    }),
  );
}

// POST …/transfer — owner-only, and immediate. The recipient must already be a
// collaborator: a transfer to an arbitrary account would create the membership
// and the owner in one step, bypassing the invitation's consent. The tier is
// deliberately not consulted — the cap gates creation, not ownership.
accessRoutes.post(
  "/catalogues/:catalogueId/transfer",
  requireSession,
  async (c) => {
    const catalogue = await requireOwnerCatalogue(c, param(c, "catalogueId"));
    const user = c.get("user");
    const payload: CatalogueTransferPayload = await parseBody(
      c,
      catalogueTransferSchema,
    );
    const targetId = payload.userId;

    if (targetId === catalogue.userId) {
      throw new ApiError("conflict", "You already own this catalogue");
    }

    // The recipient's address is the mail's `to`; the membership row is the
    // permission fact. One query answers both, and a missing row is the
    // conflict a stale card needs to hear.
    const [recipient] = await db
      .select(memberColumns)
      .from(catalogueCollaboratorsTable)
      .innerJoin(
        userTable,
        eq(userTable.id, catalogueCollaboratorsTable.userId),
      )
      .where(
        and(
          eq(catalogueCollaboratorsTable.catalogueId, catalogue.id),
          eq(catalogueCollaboratorsTable.userId, targetId),
        ),
      );
    if (!recipient) {
      throw new ApiError(
        "conflict",
        "That account is not a collaborator of this catalogue",
      );
    }

    const previousOwnerId = catalogue.userId;
    // The namespace every existing key was built with. A catalogue the old
    // code created in the migration gap has none, so the transfer writes the
    // fallback before the owner changes and those keys keep resolving. One
    // that already minted a namespace is written back unchanged.
    const namespaceId = mediaNamespaceOf(catalogue);
    const now = new Date();
    await safeTx(async (tx) => {
      // The owner column moves first, guarded by the owner the check read: two
      // transfers racing each other cannot both take the catalogue.
      const [moved] = await tx
        .update(cataloguesTable)
        .set({
          userId: targetId,
          mediaNamespaceId: namespaceId,
          updatedAt: now,
        })
        .where(
          and(
            eq(cataloguesTable.id, catalogue.id),
            eq(cataloguesTable.userId, previousOwnerId),
          ),
        )
        .returning({ id: cataloguesTable.id });
      if (!moved) {
        throw new ApiError(
          "conflict",
          "The catalogue's owner changed while this transfer was in progress",
        );
      }

      // `artworks.userId` is the owner mirror, not an authorization fact; the
      // column and the rows agree after every transfer.
      await tx
        .update(artworksTable)
        .set({ userId: targetId, updatedAt: now })
        .where(eq(artworksTable.catalogueId, catalogue.id));

      // The two membership rows swap. The delete is the permission fact inside
      // the transaction too: a recipient removed by a request that raced this
      // one rolls the whole transfer back.
      const removed = await tx
        .delete(catalogueCollaboratorsTable)
        .where(
          and(
            eq(catalogueCollaboratorsTable.catalogueId, catalogue.id),
            eq(catalogueCollaboratorsTable.userId, targetId),
          ),
        )
        .returning({ userId: catalogueCollaboratorsTable.userId });
      if (removed.length === 0) {
        throw new ApiError(
          "conflict",
          "That account is not a collaborator of this catalogue",
        );
      }
      // A stray row naming the previous owner (a hand-written seed) is not a
      // reason to fail the transfer: they are the owner column either way.
      await tx
        .insert(catalogueCollaboratorsTable)
        .values({
          catalogueId: catalogue.id,
          userId: previousOwnerId,
          createdAt: now,
        })
        .onConflictDoNothing();
    });

    // After the commit: the transfer is the durable fact, and a provider
    // outage is reported rather than undone.
    let emailSent = true;
    try {
      await sendTransferMail({
        to: recipient.email,
        firstName: recipient.firstName,
        catalogueId: catalogue.id,
        catalogueName: catalogue.name,
        previousOwnerName: displayName(user.name, user.email),
      });
    } catch {
      emailSent = false;
    }

    const response: CatalogueTransferResponse = {
      transferred: true,
      emailSent,
    };
    return c.json(response);
  },
);
