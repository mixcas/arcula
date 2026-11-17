// The Catalogue write cores: create and update as functions of an account id,
// not a Hono Context.
//
// Two callers need exactly these writes — the settings routes and the agent
// surface's `create_catalogue` / `update_catalogue` tools — and a tool that
// replayed a route would be a second copy of the tier cap, the id minting and
// the password revocation to keep in step. So the route delegates here and the
// tool calls here, and `POST /catalogues` / `PATCH /catalogues/:id` answer what
// they always did because they run this code.
//
// Membership is not re-implemented: `memberCatalogueFor` is the one write
// verdict (ADR-0004), and the update core asks it. The create core asks for the
// account's tier itself, because the tool layer has an id and no session — and
// the account's row is the tier the cap should read in both callers.

import { and, eq, isNull } from "drizzle-orm";
import {
  catalogueAccessGrants as grantsTable,
  catalogues as cataloguesTable,
  user as userTable,
} from "@arcula/db";
import {
  catalogueLimitForTier,
  type CatalogueCreatePayload,
  type CatalogueRead,
  type CatalogueUpdatePayload,
} from "@arcula/shared";
import {
  loadCatalogue,
  memberCatalogueFor,
  type CatalogueRow,
} from "./authorize";
import { hashPassword } from "./cataloguePassword";
import { db } from "./db";
import { ApiError } from "./errors";
import { safeTx } from "./http";
import { mintId } from "./ids";
import { serializeCatalogue } from "./serialize";

/** The account's tier, as the cap reads it. A missing row falls back to the
 *  shared unknown-tier answer, exactly as `catalogueLimitForTier` alone does. */
const tierOf = async (userId: string): Promise<string | undefined> =>
  (
    await db
      .select({ tier: userTable.tier })
      .from(userTable)
      .where(eq(userTable.id, userId))
  )[0]?.tier;

/**
 * Create a Catalogue owned by this account and answer it as a member read.
 *
 * The tier cap is checked before the row is written and counts only the
 * caller's own live Catalogues: a shared one does not consume their slot, and
 * a deleted one frees it the moment it is stamped. The refusal is the tier's
 * own words and code (`limit-reached`, terminal), so an agent relays it rather
 * than retrying.
 *
 * `mediaNamespaceId` is minted here and never follows the owner: it is the
 * second segment of every final media key, so a later transfer moves no
 * object.
 */
export async function createCatalogue(
  userId: string,
  payload: CatalogueCreatePayload,
): Promise<CatalogueRead> {
  const limit = catalogueLimitForTier(await tierOf(userId));
  const owned = await db
    .select({ id: cataloguesTable.id })
    .from(cataloguesTable)
    .where(
      and(
        eq(cataloguesTable.userId, userId),
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
    userId,
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
  return serializeCatalogue(row, { audience: "member" });
}

/**
 * Write an already-authorized Catalogue's settings and answer it as a member
 * read.
 *
 * Every key is optional: present sets (or, as null, clears), absent leaves the
 * column. A body that names nothing writes nothing — no column moves and
 * `updatedAt` is left alone, so "updated" continues to mean something was.
 *
 * A password present means a write: a string sets or overwrites it, `null`
 * removes it, and either revokes the catalogue's outstanding grants in the
 * same transaction, so a reader can never keep a grant to the old password.
 *
 * The route has already checked membership (before parsing, so a non-member's
 * malformed body is a refusal rather than a 400); the tool calls
 * `updateCatalogue` below, which asks the same verdict first.
 */
export async function writeCatalogue(
  catalogue: CatalogueRow,
  payload: CatalogueUpdatePayload,
): Promise<CatalogueRead> {
  // Hashing happens before the transaction — it touches no row.
  const passwordHash =
    payload.password === undefined
      ? undefined
      : payload.password === null
        ? null
        : await hashPassword(payload.password);

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
  return serializeCatalogue(row, { audience: "member" });
}

/**
 * Update a Catalogue as this account, after the one membership verdict.
 *
 * Any member may write — the owner or a Collaborator, exactly as the settings
 * tabs show it to both — and a non-member gets the app's own `forbidden`. The
 * core takes the id, not a Context, because the MCP tool layer has a verified
 * subject and no request.
 */
export async function updateCatalogue(
  userId: string,
  catalogueId: string,
  payload: CatalogueUpdatePayload,
): Promise<CatalogueRead> {
  const catalogue = await memberCatalogueFor(userId, catalogueId);
  return writeCatalogue(catalogue, payload);
}
