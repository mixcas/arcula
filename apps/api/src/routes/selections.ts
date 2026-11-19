// The Selection routes.
//
// Member (all under the source Catalogue):
//
//   GET    /catalogues/{cid}/selections                 the Catalogue's list
//   POST   /catalogues/{cid}/selections                 create
//   GET    /catalogues/{cid}/selections/{sid}           one Selection
//   PATCH  /catalogues/{cid}/selections/{sid}           rename / describe / publish / protect
//   DELETE /catalogues/{cid}/selections/{sid}           delete
//
// Public (flat, mirroring the Catalogue's address space):
//
//   GET  /selections/{sid}                              the public read
//   POST /selections/{sid}/unlock                       the lock screen's attempt
//
// Every member route is behind the session and then membership of the source
// Catalogue — owner or collaborator, as everywhere a write lives (ADR-0004).
// A stranger gets the same not-found as a Selection that is not there, and the
// check runs before a PATCH body is parsed, so a non-member's malformed body is
// the refusal rather than a validation error.
//
// The public read resolves the session optionally: a member previewing their
// own private Selection at its address is legitimate, so the API — not the
// page — decides what may be read. The unlock route's grant, throttle and
// cookie are the Selection's own; the Catalogue's are untouched.

import { and, eq, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import {
  selectionAccessGrants as selectionGrantsTable,
  selectionUnlockAttempts as selectionUnlockTable,
} from "@arcula/db";
import {
  selectionCreateSchema,
  selectionUnlockSchema,
  selectionUpdateSchema,
  type SelectionCreatePayload,
  type SelectionUnlockPayload,
  type SelectionUpdatePayload,
} from "@arcula/shared";
import {
  loadSelectionWithCatalogue,
  readableSelectionFor,
  requireMemberSelection,
  selectionGrantHeld,
  memberCatalogueForSelection,
} from "../authorize";
import { verifyPassword } from "../cataloguePassword";
import { CLIENT_ADDRESS_HEADER, clientAddress } from "../clientAddress";
import { db } from "../db";
import { useSecureCookies } from "../env";
import { ApiError } from "../errors";
import { param, parseBody } from "../http";
import {
  readPublicSelection,
  readSelection,
  readSelectionPage,
} from "../selectionRead";
import {
  GRANT_COOKIE_PATH,
  GRANT_TTL_MS,
  hashGrantToken,
  mintGrantToken,
  selectionGrantCookieName,
} from "../selectionGrants";
import {
  createSelection,
  deleteSelection,
  writeSelection,
} from "../selectionWrite";
import { requireSession, resolveSession } from "../session";
import {
  UNLOCK_MAX_FAILURES,
  UNLOCK_WINDOW_MINUTES,
  unlockWindowStart,
} from "../unlockThrottle";

export const selectionRoutes = new Hono();

// GET …/selections — the Catalogue's live Selections, name-ordered, each with
// its live-work count and last change. The envelope is an object so a page
// fact can join it later; the route answers every member of the Catalogue.
selectionRoutes.get(
  "/catalogues/:catalogueId/selections",
  requireSession,
  async (c) => {
    const catalogueId = param(c, "catalogueId");
    await memberCatalogueForSelection(c.get("user").id, catalogueId);
    return c.json({ selections: await readSelectionPage(catalogueId) });
  },
);

// POST …/selections — create. The write core asks the membership verdict and
// mints the id; the schema has already trimmed the name and turned a blank
// description into "nothing".
selectionRoutes.post(
  "/catalogues/:catalogueId/selections",
  requireSession,
  async (c) => {
    const payload: SelectionCreatePayload = await parseBody(
      c,
      selectionCreateSchema,
    );
    return c.json(
      await createSelection(c.get("user").id, param(c, "catalogueId"), payload),
      201,
    );
  },
);

// GET …/selections/{sid} — the member read. The row is the one the membership
// verdict just loaded, so the read emits it rather than asking again.
selectionRoutes.get(
  "/catalogues/:catalogueId/selections/:selectionId",
  requireSession,
  async (c) => {
    const { selection } = await requireMemberSelection(
      c,
      param(c, "catalogueId"),
      param(c, "selectionId"),
    );
    return c.json(readSelection(selection));
  },
);

// PATCH …/selections/{sid} — rename, describe, publish and protect. The
// membership check is first, before the body is parsed, as the Catalogue's
// settings route does. A password write — set, change or clear — revokes the
// Selection's grants in the write core's transaction.
selectionRoutes.patch(
  "/catalogues/:catalogueId/selections/:selectionId",
  requireSession,
  async (c) => {
    const { selection } = await requireMemberSelection(
      c,
      param(c, "catalogueId"),
      param(c, "selectionId"),
    );
    const payload: SelectionUpdatePayload = await parseBody(
      c,
      selectionUpdateSchema,
    );
    return c.json(await writeSelection(selection, payload));
  },
);

// DELETE …/selections/{sid} — stamp the Selection and close its grants. The
// works, their photos and the Catalogue stay.
selectionRoutes.delete(
  "/catalogues/:catalogueId/selections/:selectionId",
  requireSession,
  async (c) => {
    await deleteSelection(
      c.get("user").id,
      param(c, "catalogueId"),
      param(c, "selectionId"),
    );
    return c.body(null, 204);
  },
);

/**
 * The public Selection address: flat, session-optional, and readable without
 * any Catalogue membership when the Selection itself is public.
 *
 * A member may preview a Private Selection here, which is why the session is
 * resolved rather than required and why the read does not reject a private
 * document client-side: the API decides, and its answer is the truth the page
 * renders.
 */
export const publicSelectionRoutes = new Hono();

publicSelectionRoutes.get("/selections/:selectionId", async (c) => {
  const session = await resolveSession(c);
  const selectionId = param(c, "selectionId");
  const pair = await readableSelectionFor(
    session?.user.id ?? null,
    selectionId,
    () => selectionGrantHeld(c, selectionId),
  );
  return c.json(readPublicSelection(pair.selection, pair.catalogue));
});

// POST /selections/{sid}/unlock — the lock screen's password attempt, and the
// one route a non-member reaches a Protected Selection through.
//
// It mirrors the Catalogue's unlock route exactly, with the Selection's own
// tables and cookie: 404 when the Selection or its Catalogue is missing or
// deleted; 409 when the Selection is not protected (private, or public with no
// password); the throttle claimed *before* the secret is read, keyed
// `(address, selectionId)` so one Selection's failures never lock another's
// visitors out; then a 32-byte token whose only stored form is its SHA-256, in
// a row that expires in twelve hours, handed back as the cookie named for this
// Selection on the API path.
//
// The throttle is the Catalogue's arithmetic, unchanged: a fixed ten-minute
// window, ten failures, and a refused claim is the 429. The consequence is the
// same and deliberate — a right password past the limit is refused too.
publicSelectionRoutes.post("/selections/:selectionId/unlock", async (c) => {
  const selectionId = param(c, "selectionId");
  const pair = await loadSelectionWithCatalogue(selectionId);
  if (!pair) {
    throw new ApiError("not-found", "The selection does not exist");
  }
  const { selection } = pair;
  if (!selection.isPublic || selection.passwordHash === null) {
    throw new ApiError("conflict", "This selection is not protected");
  }
  const payload: SelectionUnlockPayload = await parseBody(
    c,
    selectionUnlockSchema,
  );

  const ip = clientAddress(c.req.header(CLIENT_ADDRESS_HEADER));
  const windowStart = unlockWindowStart(new Date());
  const [claim] = await db
    .insert(selectionUnlockTable)
    .values({ ip, selectionId: selection.id, windowStart, attempts: 1 })
    .onConflictDoUpdate({
      target: [
        selectionUnlockTable.ip,
        selectionUnlockTable.selectionId,
        selectionUnlockTable.windowStart,
      ],
      set: { attempts: sql`${selectionUnlockTable.attempts} + 1` },
      // Past the allowance the UPDATE matches nothing, so the claim returns
      // no row and nothing about this attempt is recorded.
      setWhere: lt(selectionUnlockTable.attempts, UNLOCK_MAX_FAILURES),
    })
    .returning({ attempts: selectionUnlockTable.attempts });
  if (!claim) {
    throw new ApiError(
      "too-many-attempts",
      `Too many failed attempts. Try again once this ${UNLOCK_WINDOW_MINUTES}-minute window has passed.`,
      { windowMinutes: UNLOCK_WINDOW_MINUTES },
    );
  }

  if (!(await verifyPassword(payload.password, selection.passwordHash))) {
    throw new ApiError("invalid-password", "That is not the password");
  }

  // A right password leaves no debt: every counter row for this address and
  // Selection goes, so the next attempt starts the window from zero even if
  // this one was the ninth.
  await db
    .delete(selectionUnlockTable)
    .where(
      and(
        eq(selectionUnlockTable.ip, ip),
        eq(selectionUnlockTable.selectionId, selection.id),
      ),
    );

  const now = new Date();
  const token = mintGrantToken();
  await db.insert(selectionGrantsTable).values({
    selectionId: selection.id,
    tokenHash: hashGrantToken(token),
    createdAt: now,
    expiresAt: new Date(now.getTime() + GRANT_TTL_MS),
  });
  // One number for both clocks: the cookie lapses when the row does.
  setCookie(c, selectionGrantCookieName(selection.id), token, {
    httpOnly: true,
    sameSite: "Lax",
    path: GRANT_COOKIE_PATH,
    maxAge: GRANT_TTL_MS / 1000,
    secure: useSecureCookies,
  });
  return c.json({ unlocked: true }, 201);
});
