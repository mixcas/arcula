// The collection resource routes:
//
//   GET    /collections                              the owner's list / the public list
//   POST   /collections                              create (cap check first)
//   GET    /collections/{cid}                        one collection
//   PATCH  /collections/{cid}                        update
//   POST   /collections/{cid}/unlock                 the lock screen's password attempt
//   POST   /collections/{cid}/import/csv             the CSV import's bulk write
//   GET    /collections/{cid}/deleted-artworks       the Deleted view's list
//   POST   /collections/{cid}/artworks/bulk-delete   the batch soft delete
//   POST   /collections/{cid}/artworks/{aid}/restore deletedAt → NULL (present, unused in beta)
//
// Collections are never deleted (there is no trash for them in this model),
// so the cap check counts every collection the owner has.
//
// Writer access: every route below that changes a collection or its works —
// the settings, the import, the batch delete, the restore and the sweep — is
// open to any member, the owner or a collaborator (ADR-0004). The cap still
// counts OWNED collections: creating one is the caller's own, and a shared
// collection does not consume their slot.

import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  artworkDocuments as artworkDocumentsTable,
  artworkPhotos as artworkPhotosTable,
  artworks as artworksTable,
  collectionAccessGrants as grantsTable,
  collectionCollaborators as collectionCollaboratorsTable,
  collectionUnlockAttempts as unlockAttemptsTable,
  collections as collectionsTable,
  user as userTable,
} from "@arcula/db";
import {
  UPDATABLE_TEXT_FIELDS,
  artworkBulkDeleteSchema,
  artworkImportSchema,
  collectionCreateSchema,
  collectionUnlockSchema,
  collectionUpdateSchema,
  collectionLimitForTier,
  artworkSchema,
  IMPORTED_WORK_STATUS,
  type ArtworkBulkDeletePayload,
  type ArtworkImportPayload,
  type CollectionCreatePayload,
  type CollectionUnlockPayload,
  type CollectionUpdatePayload,
} from "@arcula/shared";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { readDeletedArtworkList } from "../artworkRead";
import {
  loadCollection,
  requireMemberArtwork,
  requireMemberCollection,
  requireReadableCollection,
} from "../authorize";
import { CLIENT_ADDRESS_HEADER, clientAddress } from "../clientAddress";
import {
  GRANT_COOKIE_PATH,
  GRANT_TTL_MS,
  grantCookieName,
  hashGrantToken,
  mintGrantToken,
} from "../collectionGrants";
import { hashPassword, verifyPassword } from "../collectionPassword";
import { db } from "../db";
import { useSecureCookies } from "../env";
import { ApiError } from "../errors";
import { param, parseBody, safeTx } from "../http";
import { mintId } from "../ids";
import { parseMediaKey, stagedCollectionPrefix } from "../media/keys";
import { deleteObject, listObjects } from "../storage";
import { requireSession, resolveSession } from "../session";
import { displayName, serializeCollection } from "../serialize";
import {
  UNLOCK_MAX_FAILURES,
  UNLOCK_WINDOW_MINUTES,
  unlockWindowStart,
} from "../unlockThrottle";

export const collectionRoutes = new Hono();

// GET /collections — signed in: the collections the caller owns *and* those
// shared with them, together, name-ordered, each row carrying its `role`
// (and, on a shared row, the owner's display name); anonymous: the public
// list, which excludes a Protected collection exactly as it excludes a
// Private one, so a collection with a password is reachable only by its
// direct link (ADR-0005). A signed-in visitor never sees other people's
// collections through this route.
//
// The two are one list on purpose (ADR-0004): a separate `/shared` endpoint
// would split one list into two client paths and make the dashboard merge
// them.
//
// The anonymous filter is the SQL form of `canSeeCollection(null, row)` in
// access.ts — public AND not protected — and collections.api.test.ts asserts
// the two agree.
collectionRoutes.get("/collections", async (c) => {
  const session = await resolveSession(c);
  if (session === null) {
    const rows = await db
      .select()
      .from(collectionsTable)
      .where(
        and(
          eq(collectionsTable.isPublic, true),
          isNull(collectionsTable.passwordHash),
        ),
      )
      .orderBy(asc(collectionsTable.name));
    return c.json(rows.map((row) => serializeCollection(row)));
  }

  const userId = session.user.id;
  // One query, so the two halves share one collation and a stray membership
  // row for the owner cannot list the collection twice: the owner column
  // decides the role, and the join only says "shared with this account".
  const rows = await db
    .select({
      collection: collectionsTable,
      ownerName: userTable.name,
      ownerEmail: userTable.email,
    })
    .from(collectionsTable)
    .innerJoin(userTable, eq(userTable.id, collectionsTable.userId))
    .leftJoin(
      collectionCollaboratorsTable,
      and(
        eq(collectionCollaboratorsTable.collectionId, collectionsTable.id),
        eq(collectionCollaboratorsTable.userId, userId),
      ),
    )
    .where(
      or(
        eq(collectionsTable.userId, userId),
        eq(collectionCollaboratorsTable.userId, userId),
      ),
    )
    .orderBy(asc(collectionsTable.name));

  return c.json(
    rows.map(({ collection, ownerName, ownerEmail }) => {
      if (collection.userId === userId) {
        return serializeCollection(collection, {
          role: "owner",
          audience: "member",
        });
      }
      // The glossary's "the owner's display name, falling back to email": an
      // account with no usable name is named by its address.
      return serializeCollection(collection, {
        role: "collaborator",
        ownerName: displayName(ownerName, ownerEmail),
        audience: "member",
      });
    }),
  );
});

// POST /collections — the cap check comes FIRST: the count is over the
// caller's own collections, the limit is read off the caller's tier.
collectionRoutes.post("/collections", requireSession, async (c) => {
  const user = c.get("user");
  const payload: CollectionCreatePayload = await parseBody(
    c,
    collectionCreateSchema,
  );

  const limit = collectionLimitForTier(user.tier);
  const owned = await db
    .select({ id: collectionsTable.id })
    .from(collectionsTable)
    .where(eq(collectionsTable.userId, user.id));
  if (owned.length >= limit) {
    throw new ApiError(
      "limit-reached",
      `Your plan allows at most ${limit} collection${limit === 1 ? "" : "s"}`,
    );
  }

  const id = mintId();
  const now = new Date();
  await db.insert(collectionsTable).values({
    id,
    userId: user.id,
    // Fixed at creation: the second segment of every final media key, so a
    // later transfer of the collection moves no object. A fresh opaque id,
    // not the owner's — the owner may change, the namespace may not.
    mediaNamespaceId: mintId(),
    name: payload.name,
    description: payload.description ?? null,
    isPublic: payload.isPublic,
    createdAt: now,
    updatedAt: now,
  });
  // The insert just committed; read-back failure is a server bug.
  const row = await loadCollection(id);
  if (!row) {
    throw new ApiError(
      "internal",
      "The created collection could not be read back",
    );
  }
  return c.json(serializeCollection(row, { audience: "member" }), 201);
});

// GET one — a member always; a visitor when the collection is public. The
// password flag is the member's alone: a visitor's document does not carry it.
collectionRoutes.get("/collections/:collectionId", async (c) => {
  const { collection, audience } = await requireReadableCollection(
    c,
    param(c, "collectionId"),
  );
  return c.json(serializeCollection(collection, { audience }));
});

// PATCH — any member: the owner or a collaborator, exactly as the settings
// form shows it to both. Present sets (or, as null, clears); absent leaves
// the column, which is what makes the settings form's "write only what
// changed" payloads safe.
collectionRoutes.patch(
  "/collections/:collectionId",
  requireSession,
  async (c) => {
    const collection = await requireMemberCollection(
      c,
      param(c, "collectionId"),
    );
    const payload: CollectionUpdatePayload = await parseBody(
      c,
      collectionUpdateSchema,
    );

    // A password present means a write: a string sets (or overwrites) it,
    // `null` removes it. Hashing happens before the transaction — it touches
    // no row — and the update plus the grant revocation share one, so a
    // change can never leave a reader holding a grant to the old password.
    // An absent key leaves the column alone, which is why making a collection
    // private and public again returns it to Protected.
    const passwordHash =
      payload.password === undefined
        ? undefined
        : payload.password === null
          ? null
          : await hashPassword(payload.password);

    const set: Partial<typeof collectionsTable.$inferInsert> = {
      name: payload.name,
      isPublic: payload.isPublic,
      updatedAt: new Date(),
    };
    if (payload.description !== undefined) {
      set.description = payload.description ?? null;
    }
    if (payload.skin !== undefined) {
      set.skin = payload.skin ?? null;
    }
    if (payload.skinOptions !== undefined) {
      set.skinOptions = payload.skinOptions ?? null;
    }
    if (passwordHash !== undefined) {
      set.passwordHash = passwordHash;
    }
    await safeTx(async (tx) => {
      await tx
        .update(collectionsTable)
        .set(set)
        .where(eq(collectionsTable.id, collection.id));
      if (passwordHash !== undefined) {
        // Revocation, in the same transaction: setting and changing are one
        // operation, and removing has nothing left to admit.
        await tx
          .delete(grantsTable)
          .where(eq(grantsTable.collectionId, collection.id));
      }
    });

    const row = await loadCollection(collection.id);
    if (!row) {
      throw new ApiError(
        "internal",
        "The saved collection could not be read back",
      );
    }
    return c.json(serializeCollection(row, { audience: "member" }));
  },
);

// POST …/unlock — the lock screen's password attempt, and the one route a
// non-member reaches a Protected collection through.
//
// A right password mints an Access grant: a 32-byte token whose only stored
// form is its SHA-256 hash, in a row that expires in twelve hours, handed back
// as the cookie named for this collection on the API path. The cookie is
// `HttpOnly` because no script needs it, and `SameSite=Lax` because one
// collection's page fetching another's bytes is not a case the product has.
//
// A wrong password is `403 invalid-password`, deliberately distinct from the
// uniform `not-found` an invitation token gets: the reader already has the
// lock screen, which named the collection, so a uniform refusal would buy no
// secrecy and only cost the prompt the ability to say "that is not it"
// (ADR-0005).
//
// A collection with no password, or a private one, is not unlockable at all:
// there is nothing in front of it to get past. The attempt is answered `409`
// — the state the request does not suit, rather than a permission question.
//
// **The throttle.** This is the one route whose purpose is to be guessed at,
// so its attempts are counted in `collection_unlock_attempts`, per address and
// per collection, in a **fixed** ten-minute window (unlockThrottle.ts has the
// arithmetic and the reason it is fixed). The count is spent *before* the
// secret is read, in one atomic claim: an INSERT that opens the window's row,
// or an UPDATE that adds this failure to it while the window still has room
// (`setWhere`). A refused claim is the `429`, and because it is one statement,
// two attempts racing for the tenth failure cannot both get through. The
// consequence is deliberate — a right password past the limit is refused too:
// the throttle is about the address's attempts, not about which secret they
// guessed.
//
// The refusal states the window and nothing about the time left in it, and
// carries no `Retry-After` for the same reason: a countdown would tell a
// guesser exactly when their next ten attempts open.
collectionRoutes.post("/collections/:collectionId/unlock", async (c) => {
  const collection = await loadCollection(param(c, "collectionId"));
  if (!collection) {
    throw new ApiError("not-found", "The collection does not exist");
  }
  if (!collection.isPublic || collection.passwordHash === null) {
    throw new ApiError("conflict", "This collection is not protected");
  }
  const payload: CollectionUnlockPayload = await parseBody(
    c,
    collectionUnlockSchema,
  );

  const ip = clientAddress(c.req.header(CLIENT_ADDRESS_HEADER));
  const windowStart = unlockWindowStart(new Date());
  const [claim] = await db
    .insert(unlockAttemptsTable)
    .values({ ip, collectionId: collection.id, windowStart, attempts: 1 })
    .onConflictDoUpdate({
      target: [
        unlockAttemptsTable.ip,
        unlockAttemptsTable.collectionId,
        unlockAttemptsTable.windowStart,
      ],
      set: { attempts: sql`${unlockAttemptsTable.attempts} + 1` },
      // Past the allowance the UPDATE matches nothing, so the claim returns
      // no row and nothing about this attempt is recorded.
      setWhere: lt(unlockAttemptsTable.attempts, UNLOCK_MAX_FAILURES),
    })
    .returning({ attempts: unlockAttemptsTable.attempts });
  if (!claim) {
    throw new ApiError(
      "too-many-attempts",
      `Too many failed attempts. Try again once this ${UNLOCK_WINDOW_MINUTES}-minute window has passed.`,
      { windowMinutes: UNLOCK_WINDOW_MINUTES },
    );
  }

  if (!(await verifyPassword(payload.password, collection.passwordHash))) {
    throw new ApiError("invalid-password", "That is not the password");
  }

  // A right password leaves no debt: every counter row for this address and
  // collection goes, so the next attempt starts the window from zero even if
  // this one was the ninth. Deleting all of them, not just this window's, is
  // what makes "clears the counter" be true of the pair rather than of a span.
  await db
    .delete(unlockAttemptsTable)
    .where(
      and(
        eq(unlockAttemptsTable.ip, ip),
        eq(unlockAttemptsTable.collectionId, collection.id),
      ),
    );

  const now = new Date();
  const token = mintGrantToken();
  await db.insert(grantsTable).values({
    collectionId: collection.id,
    tokenHash: hashGrantToken(token),
    createdAt: now,
    expiresAt: new Date(now.getTime() + GRANT_TTL_MS),
  });
  // One number for both clocks: the cookie lapses when the row does.
  setCookie(c, grantCookieName(collection.id), token, {
    httpOnly: true,
    sameSite: "Lax",
    path: GRANT_COOKIE_PATH,
    maxAge: GRANT_TTL_MS / 1000,
    secure: useSecureCookies,
  });
  return c.json({ unlocked: true }, 201);
});

// POST …/import/csv — one row per validated artwork. Each row is checked
// against the shared `artworkSchema` the Add/Edit forms use: a failing row
// lands in `rejected` (its index plus the failed fields) and the accepted
// rows are written in one transaction. The ids are minted here — the
// client's review step has no say in them, and the shared schema is the
// only place a row's validity is decided.
collectionRoutes.post(
  "/collections/:collectionId/import/csv",
  requireSession,
  async (c) => {
    const collection = await requireMemberCollection(
      c,
      param(c, "collectionId"),
    );
    const payload: ArtworkImportPayload = await parseBody(
      c,
      artworkImportSchema,
    );

    const now = new Date();
    const rejected: { row: number; errors: Record<string, string> }[] = [];
    const accepted: (typeof artworksTable.$inferInsert)[] = [];
    payload.rows.forEach((row, index) => {
      // The import's own status wins over anything a row says: every
      // imported work is published (see IMPORTED_WORK_STATUS). A row that is
      // not an object fails the schema as a missing title.
      const fields =
        row !== null && typeof row === "object"
          ? (row as Record<string, unknown>)
          : {};
      const parsed = artworkSchema.safeParse({
        ...fields,
        status: IMPORTED_WORK_STATUS,
      });
      if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          errors[issue.path.join(".")] = issue.message;
        }
        rejected.push({ row: index, errors });
        return;
      }
      const values = parsed.data;
      const inserted: typeof artworksTable.$inferInsert = {
        id: mintId(),
        // The mirror of the collection's owner: an import adds the
        // collection's works, whoever ran it (ADR-0004).
        userId: collection.userId,
        collectionId: collection.id,
        title: values.title,
        artistName: values.artistName,
        status: values.status,
        // Always written, as null: the list filters on it, and a missing
        // field is not a null (the write-path doctrine).
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      for (const field of UPDATABLE_TEXT_FIELDS) {
        inserted[field] = values[field] ?? null;
      }
      accepted.push(inserted);
    });

    if (accepted.length > 0) {
      await safeTx(async (tx) => {
        for (const row of accepted) {
          await tx.insert(artworksTable).values(row);
        }
      });
    }

    return c.json({ inserted: accepted.length, rejected });
  },
);

// GET …/deleted-artworks — the collection's deleted works, most recently
// deleted first. Member-only: a non-member gets the same `forbidden` as every
// other member-only collection route, even when the collection is public. The
// path sits at the collection level because a static segment under `artworks`
// would be shadowed by the single-artwork route (Hono matches in registration
// order).
collectionRoutes.get(
  "/collections/:collectionId/deleted-artworks",
  requireSession,
  async (c) => {
    const read = await readDeletedArtworkList(
      param(c, "collectionId"),
      c.get("user").id,
    );
    if (read.status === "not-found") {
      throw new ApiError("not-found", "The collection does not exist");
    }
    if (read.status === "forbidden") {
      throw new ApiError(
        "forbidden",
        "You do not have access to this collection",
      );
    }
    return c.json(read.artworks);
  },
);

// POST …/artworks/bulk-delete — one transaction stamps `deletedAt`/
// `updatedAt`. Already-deleted or foreign ids are not in the WHERE clause's
// result and do not count: the response is how many works this call
// actually moved.
collectionRoutes.post(
  "/collections/:collectionId/artworks/bulk-delete",
  requireSession,
  async (c) => {
    const collection = await requireMemberCollection(
      c,
      param(c, "collectionId"),
    );
    const payload: ArtworkBulkDeletePayload = await parseBody(
      c,
      artworkBulkDeleteSchema,
    );

    const now = new Date();
    const result = await safeTx(
      async (tx) =>
        await tx
          .update(artworksTable)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(artworksTable.collectionId, collection.id),
              inArray(artworksTable.id, payload.artworkIds),
              isNull(artworksTable.deletedAt),
            ),
          )
          .returning({ id: artworksTable.id }),
    );
    return c.json({ deleted: result.length });
  },
);

// POST …/artworks/{aid}/restore — `deletedAt → NULL`, idempotent on a
// live work (restoring it is a no-op the route does not special-case).
// Present but unused in beta: there is no trash UI yet.
collectionRoutes.post(
  "/collections/:collectionId/artworks/:artworkId/restore",
  requireSession,
  async (c) => {
    const collectionId = param(c, "collectionId");
    const artworkId = param(c, "artworkId");
    const { collection, artwork } = await requireMemberArtwork(
      c,
      collectionId,
      artworkId,
    );
    await db
      .update(artworksTable)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(artworksTable.id, artwork.id),
          eq(artworksTable.collectionId, collection.id),
        ),
      );
    return c.json({ restored: true });
  },
);

// POST …/maintenance/sweep — delete this collection's staged objects
// whose entryId has no row. An entry that DOES have a row keeps its staged
// objects even under a soft-deleted work: the row is what a restore would
// point at, and the staged object may be the entry's newest version.
collectionRoutes.post(
  "/collections/:collectionId/maintenance/sweep",
  requireSession,
  async (c) => {
    const collection = await requireMemberCollection(
      c,
      param(c, "collectionId"),
    );

    // Every staged object under the caller's prefix. Staging names the
    // uploader, not the collection owner, so this is the caller's own
    // space — a collaborator's sweep cannot reach the owner's unsaved upload,
    // nor the other way round; the parser still does the entry-id recovery,
    // never the character-wise prefix (sibling entry ids share prefixes).
    const keys = await listObjects(
      stagedCollectionPrefix(c.get("user").id, collection.id),
    );
    const byEntry = new Map<string, string[]>();
    for (const key of keys) {
      const parsed = parseMediaKey(key);
      if (!parsed || parsed.kind !== "staging") continue;
      const list = byEntry.get(parsed.entryId);
      if (list) list.push(key);
      else byEntry.set(parsed.entryId, [key]);
    }

    let swept = 0;
    if (byEntry.size > 0) {
      const entryIds = [...byEntry.keys()];
      const photoRows = await db
        .select({ id: artworkPhotosTable.id })
        .from(artworkPhotosTable)
        .where(inArray(artworkPhotosTable.id, entryIds));
      const documentRows = await db
        .select({ id: artworkDocumentsTable.id })
        .from(artworkDocumentsTable)
        .where(inArray(artworkDocumentsTable.id, entryIds));
      const withRow = new Set([
        ...photoRows.map((r) => r.id),
        ...documentRows.map((r) => r.id),
      ]);
      for (const [entryId, entryKeys] of byEntry) {
        if (withRow.has(entryId)) continue;
        for (const key of entryKeys) {
          await deleteObject(key);
          swept++;
        }
      }
    }

    return c.json({ swept });
  },
);
