// The access-administration read:
//
//   GET /collections/{cid}/access   a member's view of who has access
//
// The owner and every collaborator read it; nobody else does. It answers the
// caller's role, the owner and the collaborators — and, for the owner alone,
// the pending invitations, expired ones included. That split is the whole
// design (ADR-0004): the invitation list is an administrative view of
// addresses and expiry, while the people who have access are a fact every
// member of the collection already works with.
//
// The owner is not in `collaborators`: `collections.userId` is the one owner
// fact, never a row.
//
// The access card and the settings screen read their role from here, not from
// the dashboard list: a list row's `role` is a dashboard badge, and an
// administrative screen has to ask the collection itself.

import { and, asc, eq, ne } from "drizzle-orm";
import {
  collectionCollaborators as collectionCollaboratorsTable,
  collectionInvitations as collectionInvitationsTable,
  user as userTable,
} from "@arcula/db";
import type { CollectionAccess } from "@arcula/shared";
import { Hono } from "hono";
import { requireMemberCollection } from "../authorize";
import { db } from "../db";
import { ApiError } from "../errors";
import { param } from "../http";
import { requireSession } from "../session";
import { serializeInvitation, serializeMember } from "../serialize";

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
