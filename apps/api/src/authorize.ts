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
import { resolveSession } from "./session";

export type CatalogueRow = typeof cataloguesTable.$inferSelect;
export type ArtworkRow = typeof artworksTable.$inferSelect;

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
  collectionId: string,
): Promise<CatalogueRow | null> =>
  (
    await db
      .select()
      .from(cataloguesTable)
      .where(
        and(
          eq(cataloguesTable.id, collectionId),
          isNull(cataloguesTable.deletedAt),
        ),
      )
  )[0] ?? null;

/**
 * The viewer's own membership row for a catalogue, or `null` for none.
 *
 * The owner has no row here — `collections.userId` is the one owner fact —
 * so this is asked only to place everyone else, and the query is keyed by
 * both ids so a row naming somebody else can never come back.
 */
const loadCollaborator = async (
  collectionId: string,
  userId: string,
): Promise<CollaboratorRow | null> =>
  (
    await db
      .select({ userId: catalogueCollaboratorsTable.userId })
      .from(catalogueCollaboratorsTable)
      .where(
        and(
          eq(catalogueCollaboratorsTable.collectionId, collectionId),
          eq(catalogueCollaboratorsTable.userId, userId),
        ),
      )
  )[0] ?? null;

/** The viewer's membership in a catalogue, rows loaded. An owner costs no
 *  query: `collections.userId` is the fact, and the membership row is only
 *  asked about anyone else. */
export const loadMembership = async (
  collectionId: string,
  catalogue: CatalogueFacts,
  viewer: string | null,
): Promise<Membership> => {
  if (viewer === null) return null;
  if (viewer === catalogue.userId) return "owner";
  return membershipOf(
    viewer,
    catalogue,
    await loadCollaborator(collectionId, viewer),
  );
};

export const loadArtworkInCatalogue = async (
  collectionId: string,
  artworkId: string,
): Promise<ArtworkRow | null> =>
  (
    await db
      .select()
      .from(artworksTable)
      .where(
        and(
          eq(artworksTable.collectionId, collectionId),
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
 */
export async function requireReadableCatalogue(
  c: Context,
  collectionId: string,
): Promise<{ catalogue: CatalogueRow; audience: CatalogueAudience }> {
  const catalogue = await loadCatalogue(collectionId);
  if (!catalogue) {
    throw new ApiError("not-found", "The catalogue does not exist");
  }
  const session = await resolveSession(c);
  const membership = await loadMembership(
    collectionId,
    catalogue,
    session?.user.id ?? null,
  );
  // A member bypasses the challenge, so the grant is only worth loading for
  // someone it could admit.
  const hasValidGrant = isMember(membership)
    ? false
    : await grantHeld(c, collectionId);
  if (!canSeeCatalogue(membership, catalogue, hasValidGrant)) {
    throw catalogueRefusal(catalogue);
  }
  return { catalogue, audience: audienceOf(membership) };
}

/**
 * How a catalogue the verdict refuses is answered. A Public catalogue with a
 * password is a challenge — it names itself so the lock screen can ask for the
 * password — and everything else is the plain refusal for a private one.
 *
 * The name rides in `details`, the envelope's one nested slot, because
 * `errorResponse` spreads a detail at the top level: a bare
 * `{ collectionName }` would land on `error.collectionName`, which no client
 * reads and the lock screen would never see.
 */
function catalogueRefusal(catalogue: CatalogueFacts & { name: string }) {
  if (catalogue.isPublic && catalogue.passwordHash != null) {
    return new ApiError("password-required", "This catalogue is protected", {
      details: { collectionName: catalogue.name },
    });
  }
  return new ApiError("forbidden", "This catalogue is private");
}

/**
 * Whether this request holds a usable grant for THIS catalogue.
 *
 * The cookie's name is the scope: only `arcula_grant_{collectionId}` is read,
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
  collectionId: string,
): Promise<boolean> => {
  const token = getCookie(c, grantCookieName(collectionId));
  if (!token) return false;
  const row = (
    await db
      .select({ expiresAt: grantsTable.expiresAt })
      .from(grantsTable)
      .where(
        and(
          eq(grantsTable.collectionId, collectionId),
          eq(grantsTable.tokenHash, hashGrantToken(token)),
        ),
      )
  )[0];
  return row !== undefined && isGrantUsable(row);
};

/**
 * The write-side check: the catalogue exists and the caller is a member of
 * it — its owner, or an account with a `collection_collaborators` row.
 *
 * Membership is the whole verdict (ADR-0004): a collaborator may change every
 * setting, public/private included, and every work, exactly as the owner does,
 * because there is no narrower write role to hand out. Only access
 * administration — invitations, removal, transfer — will stay owner-only when
 * those routes land, and they will say so with a check of their own.
 *
 * A missing catalogue is `404`; a non-member is `403`, matching the read
 * side's refusal for a private catalogue.
 */
export async function requireMemberCatalogue(
  c: Context,
  collectionId: string,
): Promise<CatalogueRow> {
  const catalogue = await loadCatalogue(collectionId);
  if (!catalogue) {
    throw new ApiError("not-found", "The catalogue does not exist");
  }
  const membership = await loadMembership(
    collectionId,
    catalogue,
    c.get("user").id,
  );
  if (!isMember(membership)) {
    throw new ApiError("forbidden", "You do not have access to this catalogue");
  }
  return catalogue;
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
  collectionId: string,
  refusal = "Only the catalogue's owner can manage access",
): Promise<CatalogueRow> {
  const catalogue = await requireMemberCatalogue(c, collectionId);
  if (catalogue.userId !== c.get("user").id) {
    throw new ApiError("forbidden", refusal);
  }
  return catalogue;
}

/** The membership check plus the artwork existing inside that catalogue. */
export async function requireMemberArtwork(
  c: Context,
  collectionId: string,
  artworkId: string,
): Promise<{ catalogue: CatalogueRow; artwork: ArtworkRow }> {
  const catalogue = await requireMemberCatalogue(c, collectionId);
  const artwork = await loadArtworkInCatalogue(collectionId, artworkId);
  if (!artwork) {
    throw new ApiError("not-found", "The artwork does not exist");
  }
  // `artworks.userId` is not checked: it mirrors the catalogue owner, and no
  // authorization reads it (ADR-0004). The row's catalogue is the fact.
  return { catalogue, artwork };
}
