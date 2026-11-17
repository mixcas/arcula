// The Artwork write cores: create and update as functions of an account id,
// not a Hono Context.
//
// Two callers need exactly these writes — the save routes and the agent
// surface's `create_artwork` / `update_artwork` tools — and a tool that
// replayed a route would be a second copy of the field mapping, the id
// collision check and the read-back to keep in step. So the field values and
// the update `set` live here, the route writes them inside its media
// transaction, and the tool calls `createArtworkFor` / `updateArtworkFor`,
// which use the same two builders. A field added to the Add form lands in one
// place.
//
// Membership is not re-implemented: `memberCatalogueFor` and
// `memberArtworkFor` are the one write verdict (ADR-0004), and both cores ask
// them. `artworks.userId` mirrors the catalogue's owner, never the caller: a
// collaborator saves work into someone else's catalogue.
//
// The media half stays the route's: staging, promotion and the post-commit
// object deletes are a save's own sequence, and an agent sends no bytes. What
// is shared is what a no-media write still needs — the columns, the verdict
// and the document the save answers.

import { eq } from "drizzle-orm";
import { artworks as artworksTable } from "@arcula/db";
import {
  UPDATABLE_TEXT_FIELDS,
  resolveArtworkFields,
  type ArtworkCreatePayload,
  type ArtworkFieldStates,
  type ArtworkRead,
  type ArtworkUpdatePayload,
} from "@arcula/shared";
import { assertArtworkFieldsEnabled } from "./artworkFieldRefusal";
import { readArtwork } from "./artworkRead";
import {
  loadArtworkById,
  memberArtworkFor,
  memberCatalogueFor,
  type CatalogueRow,
} from "./authorize";
import { db } from "./db";
import { ApiError } from "./errors";
import { mintId } from "./ids";

/**
 * The fields a create writes: the Add form's whole set. The staged entries
 * and the client-minted id are the save payload's additions, and a no-media
 * caller has neither — the tool mints its own id and sends no media.
 */
export type ArtworkCreateFields = Omit<
  ArtworkCreatePayload,
  "artworkId" | "photos" | "documents"
>;

/**
 * The fields an update may name. Every one is optional: a PATCH says what
 * changed, and an absent field leaves its column alone. The route's own
 * payload always names `title` and `artistName` because the Edit form submits
 * the whole record; that is legal here too.
 */
export type ArtworkUpdateFields = Partial<
  Omit<ArtworkUpdatePayload, "photos" | "documents">
>;

/**
 * The row a create writes, from whichever caller.
 *
 * `deletedAt: null` is always written — the list filters on it, and a missing
 * field is not a null (the write-path doctrine). Timestamps are the caller's,
 * so a save's field write and its media rows share one `now`.
 */
export const artworkCreateValues = (
  catalogue: CatalogueRow,
  artworkId: string,
  payload: ArtworkCreateFields,
  now: Date,
  enabled: ArtworkFieldStates,
): typeof artworksTable.$inferInsert => ({
  id: artworkId,
  // The mirror of the catalogue's owner, not the session user: a
  // collaborator saves work into someone else's catalogue (ADR-0004).
  userId: catalogue.userId,
  catalogueId: catalogue.id,
  title: payload.title,
  artistName: payload.artistName,
  serie: payload.serie ?? null,
  dateOfCreation: payload.dateOfCreation ?? null,
  medium: payload.medium ?? null,
  dimensions: payload.dimensions ?? null,
  editions: payload.editions ?? null,
  acquisitionDate: payload.acquisitionDate ?? null,
  acquisitionPrice: payload.acquisitionPrice ?? null,
  placeOfOrigin: payload.placeOfOrigin ?? null,
  provenance: payload.provenance ?? null,
  notes: payload.notes ?? null,
  condition: payload.condition ?? null,
  currentValue: payload.currentValue ?? null,
  status: payload.status,
  // A new work starts `available` where the Catalogue records a market state;
  // where it does not, the absence is null. A save that names a state — null
  // included — keeps it, so an explicit clear survives.
  availability:
    payload.availability !== undefined
      ? payload.availability
      : enabled.availability
        ? "available"
        : null,
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
});

/**
 * The `set` an update writes: present sets (or, as null, clears), absent
 * leaves the column. A body that names nothing writes nothing — no column
 * moves and `updatedAt` is left alone, so "updated" continues to mean
 * something was.
 */
export const artworkUpdateSet = (
  payload: ArtworkUpdateFields,
  now: Date,
): Partial<typeof artworksTable.$inferInsert> => {
  const set: Partial<typeof artworksTable.$inferInsert> = {};
  if (payload.title !== undefined) {
    set.title = payload.title;
  }
  if (payload.artistName !== undefined) {
    set.artistName = payload.artistName;
  }
  for (const field of UPDATABLE_TEXT_FIELDS) {
    if (payload[field] !== undefined) {
      set[field] = payload[field] ?? null;
    }
  }
  if (payload.status !== undefined) {
    set.status = payload.status;
  }
  // Present sets (or, as null, clears); absent leaves the column — the same
  // three states the text fields have. Accepted on every Kind, as the API
  // always has; a Collection records it and shows it nowhere.
  if (payload.availability !== undefined) {
    set.availability = payload.availability;
  }
  if (Object.keys(set).length > 0) {
    set.updatedAt = now;
  }
  return set;
};

/**
 * The work a save must read back; absence after a successful save is a
 * server bug, not a half-shaped response.
 */
export async function readSavedArtwork(
  catalogueId: string,
  artworkId: string,
  viewer: string,
): Promise<ArtworkRead> {
  const read = await readArtwork(catalogueId, artworkId, viewer);
  if (read.status !== "ok") {
    throw new ApiError("internal", "The saved artwork could not be read back");
  }
  return read.artwork;
}

/**
 * An id is a global primary key: reusing one would promote a save's staged
 * entries under the existing row's id. Shared with the route, whose id is
 * client-minted.
 */
export async function assertArtworkIdFree(artworkId: string): Promise<void> {
  const clash = await loadArtworkById(artworkId);
  if (clash) {
    throw new ApiError("validation", "The artwork id is already in use", {
      fields: { artworkId: "The artwork id is already in use" },
    });
  }
}

/**
 * Create an Artwork in a Catalogue as this account and answer it as a member
 * read.
 *
 * Any member may write — the owner or a Collaborator, exactly as the Add page
 * shows it to both — and a non-member gets the app's own refusal. The work's
 * `userId` mirrors the Catalogue's owner.
 *
 * The id is minted here unless the caller supplied one (the web's save
 * supplies its own so staging and the row name the same artwork); either way
 * it is checked against the primary key before anything is written.
 */
export async function createArtworkFor(
  userId: string,
  catalogueId: string,
  payload: ArtworkCreateFields & { artworkId?: string },
): Promise<ArtworkRead> {
  const catalogue = await memberCatalogueFor(userId, catalogueId);
  assertArtworkFieldsEnabled(catalogue, payload);
  const { enabled } = resolveArtworkFields(
    catalogue.kind,
    catalogue.artworkFields,
  );
  const artworkId = payload.artworkId ?? mintId();
  await assertArtworkIdFree(artworkId);
  await db
    .insert(artworksTable)
    .values(
      artworkCreateValues(catalogue, artworkId, payload, new Date(), enabled),
    );
  return readSavedArtwork(catalogue.id, artworkId, userId);
}

/**
 * Write an already-authorized Artwork's fields and answer it as a member
 * read. Shared with the route, which needs this `set` inside the transaction
 * that also rewrites the media sequences.
 */
export async function updateArtworkFor(
  userId: string,
  catalogueId: string,
  artworkId: string,
  payload: ArtworkUpdateFields,
): Promise<ArtworkRead> {
  const { catalogue, artwork } = await memberArtworkFor(
    userId,
    catalogueId,
    artworkId,
  );
  assertArtworkFieldsEnabled(catalogue, payload);
  const set = artworkUpdateSet(payload, new Date());
  if (Object.keys(set).length > 0) {
    await db
      .update(artworksTable)
      .set(set)
      .where(eq(artworksTable.id, artwork.id));
  }
  return readSavedArtwork(catalogue.id, artwork.id, userId);
}
