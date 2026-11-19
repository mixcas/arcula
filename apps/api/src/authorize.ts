// Resource authorization for /api/v1: load a row, check the caller
// against it, and hand the route a row it can trust.
//
//   readable — the catalogue exists and the viewer is a member of it or is
//              looking at something public (the visitor rule in access.ts),
//              which for a Protected catalogue also means holding a valid
//              Access grant (`grantHeld`, read off the catalogue's cookie).
//   member   — the catalogue exists and the caller is its owner or one of
//              its collaborators. Every write path — the catalogue's
//              settings, artwork create/edit/restore/bulk-delete, CSV import,
//              stage/process/discard/save/sweep — asks this one question, so a
//              collaborator can do the job they were invited to do and a
//              non-member cannot.
//
// The access verdicts themselves are not spelled out here: the read paths
// call the pure functions in access.ts over rows they have already loaded,
// and the viewer's membership row loads here so those verdicts have their one
// extra fact.
//
// The split between "does not exist" (404) and "you may not see it"
// matters for visitors: a private catalogue 403s, never 404s — the web
// client maps that refusal to its "private" state — and a Protected one
// 403s with `password-required` and its name, which maps to the lock screen.
//
// `artworks.userId` is never compared with the caller: it mirrors the
// catalogue's owner (ADR-0004), and a row's own id must not admit anyone the
// membership does not.

import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  artworks as artworksTable,
  catalogueAccessGrants as grantsTable,
  catalogueCollaborators as catalogueCollaboratorsTable,
  catalogues as cataloguesTable,
  selectionAccessGrants as selectionGrantsTable,
  selections as selectionsTable,
} from "@arcula/db";
import {
  audienceOf,
  canSeeCatalogue,
  isMember,
  membershipOf,
  type CollaboratorRow,
  type CatalogueAudience,
  type CatalogueFacts,
  type Membership,
} from "./access";
import {
  grantCookieName,
  hashGrantToken,
  isGrantUsable,
} from "./catalogueGrants";
import { db } from "./db";
import { ApiError } from "./errors";
import { canSeeSelection, selectionRefusal } from "./selectionAccess";
import { selectionGrantCookieName } from "./selectionGrants";
import { resolveSession } from "./session";

export type CatalogueRow = typeof cataloguesTable.$inferSelect;
export type ArtworkRow = typeof artworksTable.$inferSelect;
export type SelectionRow = typeof selectionsTable.$inferSelect;

/**
 * The one loading point, and therefore the one place a deleted catalogue
 * stops: a stamped row is not a catalogue any more, so every consumer of
 * this loader — the settings read and write, the artwork reads, the media
 * proxy, the invitation preview and acceptance, the unlock route, the access
 * view — answers not-found for the owner exactly as for a stranger.
 *
 * The four raw catalogue queries that bypass this loader (the anonymous
 * public list, the signed-in list, the tier-cap count and the invitee's inbox)
 * carry their own `deletedAt IS NULL` filter.
 */
export const loadCatalogue = async (
  catalogueId: string,
): Promise<CatalogueRow | null> =>
  (
    await db
      .select()
      .from(cataloguesTable)
      .where(
        and(
          eq(cataloguesTable.id, catalogueId),
          isNull(cataloguesTable.deletedAt),
        ),
      )
  )[0] ?? null;

/**
 * The viewer's own membership row for a catalogue, or `null` for none.
 *
 * The owner has no row here — `catalogues.userId` is the one owner fact —
 * so this is asked only to place everyone else, and the query is keyed by
 * both ids so a row naming somebody else can never come back.
 */
const loadCollaborator = async (
  catalogueId: string,
  userId: string,
): Promise<CollaboratorRow | null> =>
  (
    await db
      .select({ userId: catalogueCollaboratorsTable.userId })
      .from(catalogueCollaboratorsTable)
      .where(
        and(
          eq(catalogueCollaboratorsTable.catalogueId, catalogueId),
          eq(catalogueCollaboratorsTable.userId, userId),
        ),
      )
  )[0] ?? null;

/** The viewer's membership in a catalogue, rows loaded. An owner costs no
 *  query: `catalogues.userId` is the fact, and the membership row is only
 *  asked about anyone else. */
export const loadMembership = async (
  catalogueId: string,
  catalogue: CatalogueFacts,
  viewer: string | null,
): Promise<Membership> => {
  if (viewer === null) return null;
  if (viewer === catalogue.userId) return "owner";
  return membershipOf(
    viewer,
    catalogue,
    await loadCollaborator(catalogueId, viewer),
  );
};

export const loadArtworkInCatalogue = async (
  catalogueId: string,
  artworkId: string,
): Promise<ArtworkRow | null> =>
  (
    await db
      .select()
      .from(artworksTable)
      .where(
        and(
          eq(artworksTable.catalogueId, catalogueId),
          eq(artworksTable.id, artworkId),
        ),
      )
  )[0] ?? null;

/** The artwork by global id, any catalogue. The create route's
 *  collision check: an id is a primary key, and reusing one would
 *  promote the new save's staged entries under the existing row's id. */
export const loadArtworkById = async (
  artworkId: string,
): Promise<ArtworkRow | null> =>
  (
    await db.select().from(artworksTable).where(eq(artworksTable.id, artworkId))
  )[0] ?? null;

/**
 * The read-side check: the catalogue exists, and the caller is a member
 * or is looking at something public. A private catalogue a non-member
 * cannot read 403s — never 404s, the web client maps that refusal to its
 * "private" state.
 *
 * A Protected catalogue a non-member holds no grant for is the other 403, and
 * it is a distinct code (`password-required`) carrying the catalogue's name:
 * it is a challenge rather than a refusal, and the lock screen it opens has to
 * be able to name what is being unlocked (ADR-0005). The name rides that one
 * refusal only — a private catalogue's says nothing.
 *
 * The audience comes back with the row because it decides what the read may
 * say: a member's document carries the password state, a visitor's does not.
 *
 * `grantHeld` is asked only when the viewer is not a member: a member bypasses
 * the challenge, so loading the cookie's grant would be a query nobody reads.
 * The Context version passes the cookie reader; a caller with no request (the
 * MCP tool layer) takes the default, which is "no grant".
 */
export async function readableCatalogueFor(
  viewer: string | null,
  catalogueId: string,
  grantHeld: () => Promise<boolean> = () => Promise.resolve(false),
): Promise<{ catalogue: CatalogueRow; audience: CatalogueAudience }> {
  const catalogue = await loadCatalogue(catalogueId);
  if (!catalogue) {
    throw new ApiError("not-found", "The catalogue does not exist");
  }
  const membership = await loadMembership(catalogueId, catalogue, viewer);
  const hasValidGrant = isMember(membership) ? false : await grantHeld();
  if (!canSeeCatalogue(membership, catalogue, hasValidGrant)) {
    throw catalogueRefusal(catalogue);
  }
  return { catalogue, audience: audienceOf(membership) };
}

/** The Context-bound read check: the session (if any) names the viewer, and
 *  the grant is this request's cookie. Delegates the verdict to the core. */
export async function requireReadableCatalogue(
  c: Context,
  catalogueId: string,
): Promise<{ catalogue: CatalogueRow; audience: CatalogueAudience }> {
  const session = await resolveSession(c);
  return readableCatalogueFor(session?.user.id ?? null, catalogueId, () =>
    grantHeld(c, catalogueId),
  );
}

/**
 * How a catalogue the verdict refuses is answered. A Public catalogue with a
 * password is a challenge — it names itself so the lock screen can ask for the
 * password — and everything else is the plain refusal for a private one.
 *
 * The name rides in `details`, the envelope's one nested slot, because
 * `errorResponse` spreads a detail at the top level: a bare
 * `{ catalogueName }` would land on `error.catalogueName`, which no client
 * reads and the lock screen would never see.
 */
function catalogueRefusal(catalogue: CatalogueFacts & { name: string }) {
  if (catalogue.isPublic && catalogue.passwordHash != null) {
    return new ApiError("password-required", "This catalogue is protected", {
      details: { catalogueName: catalogue.name },
    });
  }
  return new ApiError("forbidden", "This catalogue is private");
}

/**
 * Whether this request holds a usable grant for THIS catalogue.
 *
 * The cookie's name is the scope: only `arcula_grant_{catalogueId}` is read,
 * so a grant minted for another catalogue is never consulted (ADR-0005). The
 * row is looked up by the catalogue id and the token's hash, so a token
 * replayed under the wrong name finds nothing either, and expiry is the same
 * pure question everywhere (`isGrantUsable`).
 *
 * A request with no such cookie costs no query — which is every member's and
 * every visitor's ordinary read.
 */
export const grantHeld = async (
  c: Context,
  catalogueId: string,
): Promise<boolean> => {
  const token = getCookie(c, grantCookieName(catalogueId));
  if (!token) return false;
  const row = (
    await db
      .select({ expiresAt: grantsTable.expiresAt })
      .from(grantsTable)
      .where(
        and(
          eq(grantsTable.catalogueId, catalogueId),
          eq(grantsTable.tokenHash, hashGrantToken(token)),
        ),
      )
  )[0];
  return row !== undefined && isGrantUsable(row);
};

/**
 * The write-side check: the catalogue exists and the caller is a member of
 * it — its owner, or an account with a `catalogueCollaborators` row.
 *
 * Membership is the whole verdict (ADR-0004): a collaborator may change every
 * setting, public/private included, and every work, exactly as the owner does,
 * because there is no narrower write role to hand out. Only access
 * administration — invitations, removal, transfer — will stay owner-only when
 * those routes land, and they will say so with a check of their own.
 *
 * A missing catalogue is `404`; a non-member is `403`, matching the read
 * side's refusal for a private catalogue.
 *
 * The core takes the user id, not a Hono Context: the MCP tool layer has a
 * verified subject and no request, and both callers must get the same verdict
 * and the same words.
 */
export async function memberCatalogueFor(
  userId: string,
  catalogueId: string,
): Promise<CatalogueRow> {
  const catalogue = await loadCatalogue(catalogueId);
  if (!catalogue) {
    throw new ApiError("not-found", "The catalogue does not exist");
  }
  const membership = await loadMembership(catalogueId, catalogue, userId);
  if (!isMember(membership)) {
    throw new ApiError("forbidden", "You do not have access to this catalogue");
  }
  return catalogue;
}

/** The Context-bound write check: the session's user, delegated to the core. */
export async function requireMemberCatalogue(
  c: Context,
  catalogueId: string,
): Promise<CatalogueRow> {
  return memberCatalogueFor(c.get("user").id, catalogueId);
}

/**
 * The owner-only check for access administration — invitations, collaborator
 * removal, leaving and transfer — and for deleting the catalogue. A
 * collaborator is a member (and may edit everything), but only the owner
 * decides who else gets in (ADR-0004) and whether the catalogue is deleted
 * (ADR-0008).
 *
 * `refusal` is the message the caller's route names the refused act with; the
 * access routes keep the default.
 */
export async function requireOwnerCatalogue(
  c: Context,
  catalogueId: string,
  refusal = "Only the catalogue's owner can manage access",
): Promise<CatalogueRow> {
  const catalogue = await requireMemberCatalogue(c, catalogueId);
  if (catalogue.userId !== c.get("user").id) {
    throw new ApiError("forbidden", refusal);
  }
  return catalogue;
}

/** The membership check plus the artwork existing inside that catalogue. */
export async function memberArtworkFor(
  userId: string,
  catalogueId: string,
  artworkId: string,
): Promise<{ catalogue: CatalogueRow; artwork: ArtworkRow }> {
  const catalogue = await memberCatalogueFor(userId, catalogueId);
  const artwork = await loadArtworkInCatalogue(catalogueId, artworkId);
  if (!artwork) {
    throw new ApiError("not-found", "The artwork does not exist");
  }
  // `artworks.userId` is not checked: it mirrors the catalogue owner, and no
  // authorization reads it (ADR-0004). The row's catalogue is the fact.
  return { catalogue, artwork };
}

/** The Context-bound version: the session's user, delegated to the core. */
export async function requireMemberArtwork(
  c: Context,
  catalogueId: string,
  artworkId: string,
): Promise<{ catalogue: CatalogueRow; artwork: ArtworkRow }> {
  return memberArtworkFor(c.get("user").id, catalogueId, artworkId);
}

/**
 * The live Selection inside one Catalogue, or `null`. Both facts are in the
 * where-clause: a Selection row names its source Catalogue, and a stamped one
 * is not a Selection any more.
 *
 * The Catalogue's own deletion is not this loader's question on the member
 * routes — the membership check below loads a live parent first. The public
 * address uses `loadSelectionWithCatalogue` instead, which joins a live
 * Catalogue and so carries the deletion rule for a visitor.
 */
export const loadSelection = async (
  catalogueId: string,
  selectionId: string,
): Promise<SelectionRow | null> =>
  (
    await db
      .select()
      .from(selectionsTable)
      .where(
        and(
          eq(selectionsTable.catalogueId, catalogueId),
          eq(selectionsTable.id, selectionId),
          isNull(selectionsTable.deletedAt),
        ),
      )
  )[0] ?? null;

/**
 * The write-mode Catalogue check for the Selection routes: the Catalogue
 * exists and the caller is a member of it.
 *
 * A stranger gets the same `not-found` as a Selection that does not exist,
 * rather than the Catalogue routes' `forbidden`: a Selection's member surface
 * is not a place to confirm what a stranger cannot reach, and the ticket's
 * contract makes the two answers one. Membership is still the whole verdict
 * (ADR-0004) — a collaborator curates exactly as the owner does.
 */
export async function memberCatalogueForSelection(
  userId: string,
  catalogueId: string,
): Promise<CatalogueRow> {
  const catalogue = await loadCatalogue(catalogueId);
  if (!catalogue) {
    throw new ApiError("not-found", "The catalogue does not exist");
  }
  const membership = await loadMembership(catalogueId, catalogue, userId);
  if (!isMember(membership)) {
    throw new ApiError("not-found", "The catalogue does not exist");
  }
  return catalogue;
}

/**
 * The Selection write verdict: membership of the source Catalogue is the whole
 * question, then a Selection that is not live in that Catalogue is the same
 * not-found a stranger got a moment earlier.
 */
export async function memberSelectionFor(
  userId: string,
  catalogueId: string,
  selectionId: string,
): Promise<{ catalogue: CatalogueRow; selection: SelectionRow }> {
  const catalogue = await memberCatalogueForSelection(userId, catalogueId);
  const selection = await loadSelection(catalogueId, selectionId);
  if (!selection) {
    throw new ApiError("not-found", "The selection does not exist");
  }
  return { catalogue, selection };
}

/** The Context-bound version: the session's user, delegated to the core. */
export async function requireMemberSelection(
  c: Context,
  catalogueId: string,
  selectionId: string,
): Promise<{ catalogue: CatalogueRow; selection: SelectionRow }> {
  return memberSelectionFor(c.get("user").id, catalogueId, selectionId);
}

/**
 * A Selection and its source Catalogue, both live, or `null`.
 *
 * The join is the whole deletion rule for the public address. Deleting the
 * source Catalogue stamps the Catalogue and nothing else — the Selection rows
 * are deliberately left unstamped so an operator's restore brings the addresses
 * back — so the only thing that can make a Selection's address 404 is this
 * `catalogues.deletedAt IS NULL` predicate. A stamped Selection is absent for
 * the same reason a stamped Catalogue is: it is not a document any more.
 */
export const loadSelectionWithCatalogue = async (
  selectionId: string,
): Promise<{ selection: SelectionRow; catalogue: CatalogueRow } | null> => {
  const row = (
    await db
      .select({
        selection: selectionsTable,
        catalogue: cataloguesTable,
      })
      .from(selectionsTable)
      .innerJoin(
        cataloguesTable,
        eq(selectionsTable.catalogueId, cataloguesTable.id),
      )
      .where(
        and(
          eq(selectionsTable.id, selectionId),
          isNull(selectionsTable.deletedAt),
          isNull(cataloguesTable.deletedAt),
        ),
      )
  )[0];
  return row ?? null;
};

/**
 * The public read check: the Selection and its Catalogue are live, and the
 * caller is a member of the source Catalogue or a visitor the Selection admits.
 *
 * A failed verdict that is not a password challenge is answered as the same
 * `not-found` a deleted Selection gets. A Private Selection therefore never
 * confirms that it exists — its name, its description and its address all stay
 * as absent as a stamped row's — which is the ticket's acceptance criterion.
 * A Protected one is the exception: it is public, so its existence is already
 * what the reader followed, and the lock screen needs a challenge it can answer.
 *
 * `grantHeld` is asked only when the viewer is not a member: a member bypasses
 * the challenge, so loading the cookie's grant would be a query nobody reads.
 * The catalogue's visibility is never consulted here; `canSeeSelection` owns
 * that decision and documents why the catalogue argument is inert.
 */
export async function readableSelectionFor(
  viewer: string | null,
  selectionId: string,
  grantHeld: () => Promise<boolean> = () => Promise.resolve(false),
): Promise<{
  selection: SelectionRow;
  catalogue: CatalogueRow;
  catalogueName: string;
  audience: CatalogueAudience;
}> {
  const pair = await loadSelectionWithCatalogue(selectionId);
  if (!pair) {
    throw new ApiError("not-found", "The selection does not exist");
  }
  const membership = await loadMembership(
    pair.catalogue.id,
    pair.catalogue,
    viewer,
  );
  const hasValidGrant = isMember(membership) ? false : await grantHeld();
  if (
    !canSeeSelection(membership, pair.catalogue, pair.selection, hasValidGrant)
  ) {
    const refusal = selectionRefusal(pair.selection);
    if (refusal.code !== "password-required") {
      throw new ApiError("not-found", "The selection does not exist");
    }
    throw refusal;
  }
  return {
    selection: pair.selection,
    catalogue: pair.catalogue,
    catalogueName: pair.catalogue.name,
    audience: audienceOf(membership),
  };
}

/**
 * Whether this request holds a usable grant for THIS Selection.
 *
 * The cookie's name is the scope: only `arcula_selection_grant_{selectionId}`
 * is read, so a grant minted for another Selection — or for a Catalogue — is
 * never consulted. The row is looked up by the Selection id and the token's
 * hash, so a token replayed under the wrong name finds nothing either, and
 * expiry is the same pure question everywhere (`isGrantUsable`).
 *
 * A request with no such cookie costs no query — which is every member's and
 * every visitor's ordinary read.
 */
export const selectionGrantHeld = async (
  c: Context,
  selectionId: string,
): Promise<boolean> => {
  const token = getCookie(c, selectionGrantCookieName(selectionId));
  if (!token) return false;
  const row = (
    await db
      .select({ expiresAt: selectionGrantsTable.expiresAt })
      .from(selectionGrantsTable)
      .where(
        and(
          eq(selectionGrantsTable.selectionId, selectionId),
          eq(selectionGrantsTable.tokenHash, hashGrantToken(token)),
        ),
      )
  )[0];
  return row !== undefined && isGrantUsable(row);
};
