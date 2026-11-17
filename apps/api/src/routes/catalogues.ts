// The catalogue resource routes:
//
//   GET    /catalogues                              the owner's list / the public list
//   POST   /catalogues                              create (cap check first)
//   GET    /catalogues/{cid}                        one catalogue
//   PATCH  /catalogues/{cid}                        update
//   DELETE /catalogues/{cid}                        delete (owner only)
//   POST   /catalogues/{cid}/unlock                 the lock screen's password attempt
//   POST   /catalogues/{cid}/import/csv             the CSV import's bulk write
//   GET    /catalogues/{cid}/deleted-artworks       the Deleted view's list
//   POST   /catalogues/{cid}/artworks/bulk-delete   the batch soft delete
//   POST   /catalogues/{cid}/artworks/bulk-restore  the batch restore
//   POST   /catalogues/{cid}/artworks/{aid}/restore deletedAt → NULL (one work, both UIs)
//
// A catalogue is deleted by its owner alone, and the stamp is the whole
// record: `deletedAt` makes the loader refuse the row, so every address that
// named it answers not-found. Nothing cascades — the works, their media and
// the collaborator rows stay — and the cap counts only live catalogues, so a
// delete frees its slot immediately.
//
// Writer access: every route below that changes a catalogue or its works —
// the settings, the import, the batch delete, the restore and the sweep — is
// open to any member, the owner or a collaborator (ADR-0004); the delete is
// the one that is the owner's alone. The cap still counts OWNED catalogues
// that are live: creating one is the caller's own, a shared catalogue does
// not consume their slot, and a deleted one frees it.

import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  artworkDocuments as artworkDocumentsTable,
  artworkPhotos as artworkPhotosTable,
  artworks as artworksTable,
  catalogueAccessGrants as grantsTable,
  catalogueCollaborators as catalogueCollaboratorsTable,
  catalogueInvitations as catalogueInvitationsTable,
  catalogueUnlockAttempts as unlockAttemptsTable,
  catalogues as cataloguesTable,
  user as userTable,
} from "@arcula/db";
import {
  UPDATABLE_TEXT_FIELDS,
  artworkBulkSelectionSchema,
  artworkImportSchema,
  catalogueCreateSchema,
  catalogueUnlockSchema,
  catalogueUpdateSchema,
  catalogueLimitForTier,
  artworkSchema,
  disabledArtworkFieldsIn,
  IMPORTED_WORK_STATUS,
  normaliseArtworkFields,
  resolveArtworkFields,
  type ArtworkBulkSelectionPayload,
  type ArtworkImportPayload,
  type CatalogueCreatePayload,
  type CatalogueUnlockPayload,
  type CatalogueUpdatePayload,
} from "@arcula/shared";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { readDeletedArtworkList } from "../artworkRead";
import {
  loadCatalogue,
  requireMemberArtwork,
  requireMemberCatalogue,
  requireOwnerCatalogue,
  requireReadableCatalogue,
} from "../authorize";
import { CLIENT_ADDRESS_HEADER, clientAddress } from "../clientAddress";
import {
  GRANT_COOKIE_PATH,
  GRANT_TTL_MS,
  grantCookieName,
  hashGrantToken,
  mintGrantToken,
} from "../catalogueGrants";
import { hashPassword, verifyPassword } from "../cataloguePassword";
import { collaboratorJoin, readableCataloguesWhere } from "../catalogueScope";
import { db } from "../db";
import { useSecureCookies } from "../env";
import { ApiError } from "../errors";
import { param, parseBody, safeTx } from "../http";
import { mintId } from "../ids";
import { parseMediaKey, stagedCataloguePrefix } from "../media/keys";
import { deleteObject, listObjects } from "../storage";
import { requireSession, resolveSession } from "../session";
import { displayName, serializeCatalogue } from "../serialize";
import {
  UNLOCK_MAX_FAILURES,
  UNLOCK_WINDOW_MINUTES,
  unlockWindowStart,
} from "../unlockThrottle";

export const catalogueRoutes = new Hono();

/**
 * The one write behind both batch routes: move a catalogue's deletion stamp
 * for the selected ids and answer how many rows moved.
 *
 * Delete stamps the ids that are live; restore clears the ones that are
 * stamped. An id already in the other state is not in the WHERE clause and is
 * not counted, so a repeated call is a no-op and the answer is always what
 * this call actually changed. The two routes keep their own response key; only
 * the update is shared.
 */
async function moveDeletionStamp(
  catalogueId: string,
  artworkIds: readonly string[],
  direction: "delete" | "restore",
): Promise<number> {
  const now = new Date();
  const result = await safeTx(
    async (tx) =>
      await tx
        .update(artworksTable)
        .set({
          deletedAt: direction === "delete" ? now : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(artworksTable.catalogueId, catalogueId),
            inArray(artworksTable.id, [...artworkIds]),
            direction === "delete"
              ? isNull(artworksTable.deletedAt)
              : isNotNull(artworksTable.deletedAt),
          ),
        )
        .returning({ id: artworksTable.id }),
  );
  return result.length;
}

// GET /catalogues — signed in: the catalogues the caller owns *and* those
// shared with them, together, name-ordered, each row carrying its `role`
// (and, on a shared row, the owner's display name); anonymous: the public
// list, which excludes a Protected catalogue exactly as it excludes a
// Private one, so a catalogue with a password is reachable only by its
// direct link (ADR-0005). A signed-in visitor never sees other people's
// catalogues through this route.
//
// The two are one list on purpose (ADR-0004): a separate `/shared` endpoint
// would split one list into two client paths and make the dashboard merge
// them.
//
// The anonymous filter is the SQL form of `canSeeCatalogue(null, row)` in
// access.ts — public AND not protected — and catalogues.api.test.ts asserts
// the two agree.
catalogueRoutes.get("/catalogues", async (c) => {
  const session = await resolveSession(c);
  if (session === null) {
    const rows = await db
      .select()
      .from(cataloguesTable)
      .where(
        and(
          eq(cataloguesTable.isPublic, true),
          isNull(cataloguesTable.passwordHash),
          isNull(cataloguesTable.deletedAt),
        ),
      )
      .orderBy(asc(cataloguesTable.name));
    return c.json(rows.map((row) => serializeCatalogue(row)));
  }

  const userId = session.user.id;
  // One query, so the two halves share one collation and a stray membership
  // row for the owner cannot list the catalogue twice: the owner column
  // decides the role, and the join only says "shared with this account".
  const rows = await db
    .select({
      catalogue: cataloguesTable,
      ownerName: userTable.name,
      ownerEmail: userTable.email,
    })
    .from(cataloguesTable)
    .innerJoin(userTable, eq(userTable.id, cataloguesTable.userId))
    .leftJoin(catalogueCollaboratorsTable, collaboratorJoin(userId))
    .where(readableCataloguesWhere(userId))
    .orderBy(asc(cataloguesTable.name));

  return c.json(
    rows.map(({ catalogue, ownerName, ownerEmail }) => {
      if (catalogue.userId === userId) {
        return serializeCatalogue(catalogue, {
          role: "owner",
          audience: "member",
        });
      }
      // The glossary's "the owner's display name, falling back to email": an
      // account with no usable name is named by its address.
      return serializeCatalogue(catalogue, {
        role: "collaborator",
        ownerName: displayName(ownerName, ownerEmail),
        audience: "member",
      });
    }),
  );
});

// POST /catalogues — the body validates first, then the cap is checked
// before the row is written: the count is over the caller's own catalogues,
// the limit is read off the caller's tier.
catalogueRoutes.post("/catalogues", requireSession, async (c) => {
  const user = c.get("user");
  const payload: CatalogueCreatePayload = await parseBody(
    c,
    catalogueCreateSchema,
  );

  const limit = catalogueLimitForTier(user.tier);
  const owned = await db
    .select({ id: cataloguesTable.id })
    .from(cataloguesTable)
    .where(
      and(
        eq(cataloguesTable.userId, user.id),
        // A deleted catalogue frees its slot the moment it is stamped.
        isNull(cataloguesTable.deletedAt),
      ),
    );
  if (owned.length >= limit) {
    throw new ApiError(
      "limit-reached",
      `Your plan allows at most ${limit} catalogue${limit === 1 ? "" : "s"}`,
    );
  }

  const id = mintId();
  const now = new Date();
  await db.insert(cataloguesTable).values({
    id,
    userId: user.id,
    // Fixed at creation: the second segment of every final media key, so a
    // later transfer of the catalogue moves no object. A fresh opaque id,
    // not the owner's — the owner may change, the namespace may not.
    mediaNamespaceId: mintId(),
    name: payload.name,
    kind: payload.kind,
    description: payload.description ?? null,
    isPublic: payload.isPublic,
    createdAt: now,
    updatedAt: now,
  });
  // The insert just committed; read-back failure is a server bug.
  const row = await loadCatalogue(id);
  if (!row) {
    throw new ApiError(
      "internal",
      "The created catalogue could not be read back",
    );
  }
  return c.json(serializeCatalogue(row, { audience: "member" }), 201);
});

// GET one — a member always; a visitor when the catalogue is public. The
// password flag is the member's alone: a visitor's document does not carry it.
catalogueRoutes.get("/catalogues/:catalogueId", async (c) => {
  const { catalogue, audience } = await requireReadableCatalogue(
    c,
    param(c, "catalogueId"),
  );
  return c.json(serializeCatalogue(catalogue, { audience }));
});

// PATCH — any member: the owner or a collaborator, exactly as the settings
// tabs show it to both. Every key is optional: present sets (or, as null,
// clears), absent leaves the column, which is what makes each tab's "write
// only what changed" payload safe. A body that names nothing writes nothing:
// no column moves, and `updatedAt` is left alone, so "updated" continues to
// mean something was.
catalogueRoutes.patch("/catalogues/:catalogueId", requireSession, async (c) => {
  const catalogue = await requireMemberCatalogue(c, param(c, "catalogueId"));
  const payload: CatalogueUpdatePayload = await parseBody(
    c,
    catalogueUpdateSchema,
  );

  // A password present means a write: a string sets (or overwrites) it,
  // `null` removes it. Hashing happens before the transaction — it touches
  // no row — and the update plus the grant revocation share one, so a
  // change can never leave a reader holding a grant to the old password.
  // An absent key leaves the column alone, which is why making a catalogue
  // private and public again returns it to Protected.
  const passwordHash =
    payload.password === undefined
      ? undefined
      : payload.password === null
        ? null
        : await hashPassword(payload.password);

  // Build the update only from the keys the body carried: an absent key
  // leaves its column alone, and a body that names nothing is a successful
  // no-op that moves no column and no timestamp.
  const set: Partial<typeof cataloguesTable.$inferInsert> = {};
  if (payload.name !== undefined) {
    set.name = payload.name;
  }
  if (payload.isPublic !== undefined) {
    set.isPublic = payload.isPublic;
  }
  if (payload.description !== undefined) {
    set.description = payload.description ?? null;
  }
  if (payload.skin !== undefined) {
    set.skin = payload.skin ?? null;
  }
  if (payload.skinOptions !== undefined) {
    set.skinOptions = payload.skinOptions ?? null;
  }
  if (payload.artworkFields !== undefined) {
    // Normalised against the row's own Kind: an entry equal to the default is
    // dropped, and nothing left stores `null` — the sparse map's one state for
    // "pure defaults". `{}` and `null` both land there.
    set.artworkFields = normaliseArtworkFields(
      catalogue.kind,
      payload.artworkFields,
    );
  }
  if (passwordHash !== undefined) {
    set.passwordHash = passwordHash;
  }
  if (Object.keys(set).length > 0) {
    set.updatedAt = new Date();
    await safeTx(async (tx) => {
      await tx
        .update(cataloguesTable)
        .set(set)
        .where(eq(cataloguesTable.id, catalogue.id));
      if (passwordHash !== undefined) {
        // Revocation, in the same transaction: setting and changing are one
        // operation, and removing has nothing left to admit.
        await tx
          .delete(grantsTable)
          .where(eq(grantsTable.catalogueId, catalogue.id));
      }
    });
  }

  const row = await loadCatalogue(catalogue.id);
  if (!row) {
    throw new ApiError(
      "internal",
      "The saved catalogue could not be read back",
    );
  }
  return c.json(serializeCatalogue(row, { audience: "member" }));
});

// DELETE — owner-only. One transaction stamps `deletedAt`/`updatedAt`,
// withdraws the catalogue's pending invitations (resolved history stays the
// history it is) and closes its Access grants, so nothing can observe a
// deleted catalogue that still holds a live offer or a valid grant.
//
// The update is guarded on `deletedAt IS NULL` as well as the loader's
// refusal: two deletes racing get one stamp, and the loser answers not-found
// rather than moving the timestamp twice. Nothing else is written — that is
// what keeps the operator's restore to clearing one column.
catalogueRoutes.delete(
  "/catalogues/:catalogueId",
  requireSession,
  async (c) => {
    const catalogue = await requireOwnerCatalogue(
      c,
      param(c, "catalogueId"),
      "Only the catalogue's owner can delete it",
    );
    const now = new Date();
    await safeTx(async (tx) => {
      const stamped = await tx
        .update(cataloguesTable)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(cataloguesTable.id, catalogue.id),
            isNull(cataloguesTable.deletedAt),
          ),
        )
        .returning({ id: cataloguesTable.id });
      if (stamped.length === 0) {
        throw new ApiError("not-found", "The catalogue does not exist");
      }
      await tx
        .update(catalogueInvitationsTable)
        .set({ status: "revoked", resolvedAt: now })
        .where(
          and(
            eq(catalogueInvitationsTable.catalogueId, catalogue.id),
            eq(catalogueInvitationsTable.status, "pending"),
          ),
        );
      await tx
        .delete(grantsTable)
        .where(eq(grantsTable.catalogueId, catalogue.id));
    });
    return c.body(null, 204);
  },
);

// POST …/unlock — the lock screen's password attempt, and the one route a
// non-member reaches a Protected catalogue through.
//
// A right password mints an Access grant: a 32-byte token whose only stored
// form is its SHA-256 hash, in a row that expires in twelve hours, handed back
// as the cookie named for this catalogue on the API path. The cookie is
// `HttpOnly` because no script needs it, and `SameSite=Lax` because one
// catalogue's page fetching another's bytes is not a case the product has.
//
// A wrong password is `403 invalid-password`, deliberately distinct from the
// uniform `not-found` an invitation token gets: the reader already has the
// lock screen, which named the catalogue, so a uniform refusal would buy no
// secrecy and only cost the prompt the ability to say "that is not it"
// (ADR-0005).
//
// A catalogue with no password, or a private one, is not unlockable at all:
// there is nothing in front of it to get past. The attempt is answered `409`
// — the state the request does not suit, rather than a permission question.
//
// **The throttle.** This is the one route whose purpose is to be guessed at,
// so its attempts are counted in `catalogueUnlockAttempts`, per address and
// per catalogue, in a **fixed** ten-minute window (unlockThrottle.ts has the
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
catalogueRoutes.post("/catalogues/:catalogueId/unlock", async (c) => {
  const catalogue = await loadCatalogue(param(c, "catalogueId"));
  if (!catalogue) {
    throw new ApiError("not-found", "The catalogue does not exist");
  }
  if (!catalogue.isPublic || catalogue.passwordHash === null) {
    throw new ApiError("conflict", "This catalogue is not protected");
  }
  const payload: CatalogueUnlockPayload = await parseBody(
    c,
    catalogueUnlockSchema,
  );

  const ip = clientAddress(c.req.header(CLIENT_ADDRESS_HEADER));
  const windowStart = unlockWindowStart(new Date());
  const [claim] = await db
    .insert(unlockAttemptsTable)
    .values({ ip, catalogueId: catalogue.id, windowStart, attempts: 1 })
    .onConflictDoUpdate({
      target: [
        unlockAttemptsTable.ip,
        unlockAttemptsTable.catalogueId,
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

  if (!(await verifyPassword(payload.password, catalogue.passwordHash))) {
    throw new ApiError("invalid-password", "That is not the password");
  }

  // A right password leaves no debt: every counter row for this address and
  // catalogue goes, so the next attempt starts the window from zero even if
  // this one was the ninth. Deleting all of them, not just this window's, is
  // what makes "clears the counter" be true of the pair rather than of a span.
  await db
    .delete(unlockAttemptsTable)
    .where(
      and(
        eq(unlockAttemptsTable.ip, ip),
        eq(unlockAttemptsTable.catalogueId, catalogue.id),
      ),
    );

  const now = new Date();
  const token = mintGrantToken();
  await db.insert(grantsTable).values({
    catalogueId: catalogue.id,
    tokenHash: hashGrantToken(token),
    createdAt: now,
    expiresAt: new Date(now.getTime() + GRANT_TTL_MS),
  });
  // One number for both clocks: the cookie lapses when the row does.
  setCookie(c, grantCookieName(catalogue.id), token, {
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
//
// A field the catalogue does not record is stripped from every row before
// validation, so a file prepared for several catalogues imports here with
// every column this one can hold. Rejecting the row instead would make the
// feature hostile to exactly the reuse it exists for; the web's run summary
// names the columns it skipped.
catalogueRoutes.post(
  "/catalogues/:catalogueId/import/csv",
  requireSession,
  async (c) => {
    const catalogue = await requireMemberCatalogue(c, param(c, "catalogueId"));
    const payload: ArtworkImportPayload = await parseBody(
      c,
      artworkImportSchema,
    );
    // Resolved from the catalogue already in hand: the strip honours the
    // member's deviations, not just the Kind's defaults.
    const enabled = resolveArtworkFields(
      catalogue.kind,
      catalogue.artworkFields,
    ).enabled;

    const now = new Date();
    const rejected: { row: number; errors: Record<string, string> }[] = [];
    const accepted: (typeof artworksTable.$inferInsert)[] = [];
    payload.rows.forEach((row, index) => {
      // The import's own status wins over anything a row says: every
      // imported work is published (see IMPORTED_WORK_STATUS). A row that is
      // not an object fails the schema as a missing title.
      const fields =
        row !== null && typeof row === "object"
          ? { ...(row as Record<string, unknown>) }
          : {};
      // The same predicate the save routes refuse with, answered by deleting:
      // a row still lands with every field this catalogue does record.
      for (const field of disabledArtworkFieldsIn(enabled, fields)) {
        delete fields[field];
      }
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
        // The mirror of the catalogue's owner: an import adds the
        // catalogue's works, whoever ran it (ADR-0004).
        userId: catalogue.userId,
        catalogueId: catalogue.id,
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

// GET …/deleted-artworks — the catalogue's deleted works, most recently
// deleted first. Member-only: a non-member gets the same `forbidden` as every
// other member-only catalogue route, even when the catalogue is public. The
// path sits at the catalogue level because a static segment under `artworks`
// would be shadowed by the single-artwork route (Hono matches in registration
// order).
catalogueRoutes.get(
  "/catalogues/:catalogueId/deleted-artworks",
  requireSession,
  async (c) => {
    const read = await readDeletedArtworkList(
      param(c, "catalogueId"),
      c.get("user").id,
    );
    if (read.status === "not-found") {
      throw new ApiError("not-found", "The catalogue does not exist");
    }
    if (read.status === "forbidden") {
      throw new ApiError(
        "forbidden",
        "You do not have access to this catalogue",
      );
    }
    return c.json(read.artworks);
  },
);

// POST …/artworks/bulk-delete — one transaction stamps `deletedAt`/
// `updatedAt`. Already-deleted or foreign ids are not in the WHERE clause's
// result and do not count: the response is how many works this call
// actually moved.
catalogueRoutes.post(
  "/catalogues/:catalogueId/artworks/bulk-delete",
  requireSession,
  async (c) => {
    const catalogue = await requireMemberCatalogue(c, param(c, "catalogueId"));
    const payload: ArtworkBulkSelectionPayload = await parseBody(
      c,
      artworkBulkSelectionSchema,
    );

    return c.json({
      deleted: await moveDeletionStamp(
        catalogue.id,
        payload.artworkIds,
        "delete",
      ),
    });
  },
);

// POST …/artworks/bulk-restore — the inverse of the batch soft delete: one
// transaction clears `deletedAt` for the ids this call actually moves. A live
// id, an id from another catalogue and an id a previous call already restored
// are not in the WHERE clause's result and do not count, so a repeated call is
// a no-op rather than an error and the response is the number restored.
catalogueRoutes.post(
  "/catalogues/:catalogueId/artworks/bulk-restore",
  requireSession,
  async (c) => {
    const catalogue = await requireMemberCatalogue(c, param(c, "catalogueId"));
    const payload: ArtworkBulkSelectionPayload = await parseBody(
      c,
      artworkBulkSelectionSchema,
    );

    return c.json({
      restored: await moveDeletionStamp(
        catalogue.id,
        payload.artworkIds,
        "restore",
      ),
    });
  },
);

// POST …/artworks/{aid}/restore — `deletedAt → NULL`, idempotent on a
// live work (restoring it is a no-op the route does not special-case).
// The path both UIs use for one work: a row in the Deleted view, and the banner
// on a deleted work's Edit page.
catalogueRoutes.post(
  "/catalogues/:catalogueId/artworks/:artworkId/restore",
  requireSession,
  async (c) => {
    const catalogueId = param(c, "catalogueId");
    const artworkId = param(c, "artworkId");
    const { catalogue, artwork } = await requireMemberArtwork(
      c,
      catalogueId,
      artworkId,
    );
    await db
      .update(artworksTable)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(artworksTable.id, artwork.id),
          eq(artworksTable.catalogueId, catalogue.id),
        ),
      );
    return c.json({ restored: true });
  },
);

// POST …/maintenance/sweep — delete this catalogue's staged objects
// whose entryId has no row. An entry that DOES have a row keeps its staged
// objects even under a soft-deleted work: the row is what a restore would
// point at, and the staged object may be the entry's newest version.
catalogueRoutes.post(
  "/catalogues/:catalogueId/maintenance/sweep",
  requireSession,
  async (c) => {
    const catalogue = await requireMemberCatalogue(c, param(c, "catalogueId"));

    // Every staged object under the caller's prefix. Staging names the
    // uploader, not the catalogue owner, so this is the caller's own
    // space — a collaborator's sweep cannot reach the owner's unsaved upload,
    // nor the other way round; the parser still does the entry-id recovery,
    // never the character-wise prefix (sibling entry ids share prefixes).
    const keys = await listObjects(
      stagedCataloguePrefix(c.get("user").id, catalogue.id),
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
