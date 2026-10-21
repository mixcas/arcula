// The access-administration routes:
//
//   GET    /collections/{cid}/access                         a member's view of who has access
//   DELETE /collections/{cid}/collaborators/{userId}         owner: remove somebody
//   DELETE /collections/{cid}/collaborators/me               collaborator: leave
//
// The owner and every collaborator read the access view; nobody else does. It
// answers the caller's role, the owner and the collaborators — and, for the
// owner alone, the pending invitations, expired ones included. That split is
// the whole design (ADR-0004): the invitation list is an administrative view
// of addresses and expiry, while the people who have access are a fact every
// member of the collection already works with.
//
// The owner is not in `collaborators`: `collections.userId` is the one owner
// fact, never a row.
//
// The access card and the settings screen read their role from here, not from
// the dashboard list: a list row's `role` is a dashboard badge, and an
// administrative screen has to ask the collection itself.
//
// Access can end. Removal is the owner's (a collaborator attempting it is
// refused, even on themselves); leaving is the collaborator's own, and the
// owner is refused because a collection is never left without an owner —
// transfer first. Both delete the membership row and nothing that is saved:
// the works the departing account recorded stay in the collection, with their
// final objects, and the account is a visitor from its next request on. Only
// its unsaved uploads for that one collection are discarded — its staging
// prefix, emptied best effort. A storage failure does not fail the action; the
// seven-day staging lifecycle is the backstop.
//
// The two removal paths differ only in who may ask and in which account is
// named — the deletion and the cleanup are one helper each. `/me` is
// registered before `/:userId` so the literal segment is never read as an
// account id.

import { and, asc, eq, ne } from "drizzle-orm";
import {
  collectionCollaborators as collectionCollaboratorsTable,
  collectionInvitations as collectionInvitationsTable,
  user as userTable,
} from "@arcula/db";
import type { CollectionAccess } from "@arcula/shared";
import { Hono } from "hono";
import { requireMemberCollection, requireOwnerCollection } from "../authorize";
import { db } from "../db";
import { ApiError } from "../errors";
import { param } from "../http";
import { stagedCollectionPrefix } from "../media/keys";
import { requireSession } from "../session";
import { serializeInvitation, serializeMember } from "../serialize";
import { deleteObject, listObjects } from "../storage";

export const accessRoutes = new Hono();

/** The columns a person is named by, in both queries below. */
const memberColumns = {
  id: userTable.id,
  name: userTable.name,
  email: userTable.email,
};

accessRoutes.get(
  "/collections/:collectionId/access",
  requireSession,
  async (c) => {
    const collection = await requireMemberCollection(
      c,
      param(c, "collectionId"),
    );
    const user = c.get("user");
    // Membership is already proven, so the role is the owner column and
    // nothing else: no second membership query.
    const role = collection.userId === user.id ? "owner" : "collaborator";

    const [owner] = await db
      .select(memberColumns)
      .from(userTable)
      .where(eq(userTable.id, collection.userId));
    // The collection's owner column is not a foreign key; a dangling owner is
    // a corrupt row, not a permission question.
    if (!owner) {
      throw new ApiError("internal", "The collection's owner does not exist");
    }

    // `collaborators` is everyone except the owner: the owner fact is the
    // column, so a stray row naming the owner (a hand-written seed, a former
    // transfer's leftover) must not list them twice.
    const collaborators = await db
      .select(memberColumns)
      .from(collectionCollaboratorsTable)
      .innerJoin(
        userTable,
        eq(userTable.id, collectionCollaboratorsTable.userId),
      )
      .where(
        and(
          eq(collectionCollaboratorsTable.collectionId, collection.id),
          ne(collectionCollaboratorsTable.userId, collection.userId),
        ),
      )
      .orderBy(asc(collectionCollaboratorsTable.createdAt));

    const access: CollectionAccess = {
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
        .from(collectionInvitationsTable)
        .where(
          and(
            eq(collectionInvitationsTable.collectionId, collection.id),
            eq(collectionInvitationsTable.status, "pending"),
          ),
        )
        .orderBy(asc(collectionInvitationsTable.createdAt));
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
  collectionId: string,
  userId: string,
): Promise<boolean> {
  const [deleted] = await db
    .delete(collectionCollaboratorsTable)
    .where(
      and(
        eq(collectionCollaboratorsTable.collectionId, collectionId),
        eq(collectionCollaboratorsTable.userId, userId),
      ),
    )
    .returning({ userId: collectionCollaboratorsTable.userId });
  return deleted !== undefined;
}

/**
 * Empty the account's staging prefix for this collection — their unsaved
 * uploads for it, and nothing that was saved (a saved entry's staged objects
 * are already gone; its final objects live under the collection's namespace).
 *
 * Best effort by contract: a storage failure must not fail the removal. The
 * seven-day staging lifecycle is the backstop for whatever this could not
 * reach. The whole prefix is one uploader's space in one collection, so unlike
 * a single entry's discard there is no sibling entry id to tell apart.
 */
async function discardStagedUploads(
  collectionId: string,
  userId: string,
): Promise<void> {
  let keys: string[];
  try {
    keys = await listObjects(stagedCollectionPrefix(userId, collectionId));
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
// take it: a collection is never left without one, so the owner transfers
// first. Refusals are the membership check's (`403` for a non-member, `404`
// for a missing collection) and this handler's one conflict.
accessRoutes.delete(
  "/collections/:collectionId/collaborators/me",
  requireSession,
  async (c) => {
    const collection = await requireMemberCollection(
      c,
      param(c, "collectionId"),
    );
    const user = c.get("user");
    if (collection.userId === user.id) {
      throw new ApiError(
        "conflict",
        "Transfer the collection before leaving it",
      );
    }

    await deleteMembership(collection.id, user.id);
    await discardStagedUploads(collection.id, user.id);
    return c.json({ left: true });
  },
);

// DELETE …/collaborators/{userId} — the owner's removal. A collaborator
// attempting it is refused by the owner-only check, themselves included: a
// collaborator leaves through /me. The owner is not a collaborator row, so
// naming them is a conflict rather than a no-op, exactly as naming an account
// that never had access is.
accessRoutes.delete(
  "/collections/:collectionId/collaborators/:userId",
  requireSession,
  async (c) => {
    const collection = await requireOwnerCollection(
      c,
      param(c, "collectionId"),
    );
    const targetId = param(c, "userId");
    if (targetId === collection.userId) {
      throw new ApiError(
        "conflict",
        "The collection's owner is not a collaborator",
      );
    }

    if (!(await deleteMembership(collection.id, targetId))) {
      // The row is the access fact: no row is "this account does not have
      // access", which is what a stale access card needs to hear.
      throw new ApiError(
        "conflict",
        "That account does not have access to this collection",
      );
    }

    // The row went first, so the access has already ended by the time the
    // objects are reached: the cleanup is the residue, never the refusal.
    await discardStagedUploads(collection.id, targetId);
    return c.json({ removed: true });
  },
);
