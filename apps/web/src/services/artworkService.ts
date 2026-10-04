/**
 * The artwork service layer (Phase 4 S2, plan §7).
 *
 * Reads parse through `artworkReadSchema` (the wire contract, plan §7);
 * writes are one HTTP call each — a save is one server-side transaction
 * (fields + staged-entry promotion), so there is nothing for the client to
 * sequence the way the Firebase era did.
 *
 * The 404s on the single-artwork reads are the contract, not a failure:
 * for a visitor, a private work and a deleted work both answer 404 —
 * saying which was refused would be a disclosure — and the public views
 * map that to their not-found state.
 */

import {
  artworkReadSchema,
  type Artwork,
  type ArtworkCreatePayload,
  type ArtworkImportOutcome,
  type ArtworkUpdatePayload,
} from "@arcula/shared";
import { ApiRequestError, apiRequest } from "./api";

const base = (collectionId: string) =>
  `/api/v1/collections/${collectionId}/artworks`;

export const artworkService = {
  /** The collection's live works, for the owner's table. */
  async getCollectionArtworks(collectionId: string): Promise<Artwork[]> {
    const rows = await apiRequest<unknown[]>(base(collectionId));
    return rows.map((row) => artworkReadSchema.parse(row));
  },

  /**
   * One work, by id. A work that does not exist — or that a visitor may not
   * see (private or deleted) — resolves `null`. A private *collection*
   * rejects (403), which the public views map to their private state.
   */
  async getArtwork(
    collectionId: string,
    artworkId: string,
  ): Promise<Artwork | null> {
    try {
      const row = await apiRequest<unknown>(
        `${base(collectionId)}/${artworkId}`,
      );
      return artworkReadSchema.parse(row);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        return null;
      }
      throw err;
    }
  },

  /**
   * The Add save: fields, the client-minted id, and the staged entries
   * promoted in the same transaction. The answer is the created work.
   */
  async createArtwork(
    collectionId: string,
    payload: ArtworkCreatePayload,
  ): Promise<Artwork> {
    const row = await apiRequest<unknown>(base(collectionId), {
      method: "POST",
      body: payload,
    });
    return artworkReadSchema.parse(row);
  },

  /**
   * The Edit save: one PATCH. A cleared field is `null`; an absent one is
   * left alone; `photos`/`documents`, when present, are the full new
   * sequence — the form's `commit()` returning null for "unchanged" is what
   * produces the omission. The answer is the updated work.
   */
  async updateArtwork(
    collectionId: string,
    artworkId: string,
    payload: ArtworkUpdatePayload,
  ): Promise<Artwork> {
    const row = await apiRequest<unknown>(
      `${base(collectionId)}/${artworkId}`,
      { method: "PATCH", body: payload },
    );
    return artworkReadSchema.parse(row);
  },

  /**
   * The batch soft delete behind the table's selection. The server stamps
   * `deletedAt` and answers the count — the table refetches, it does not
   * splice.
   */
  async softDeleteArtworks(
    collectionId: string,
    artworkIds: string[],
  ): Promise<{ deleted: number }> {
    return apiRequest<{ deleted: number }>(
      `${base(collectionId)}/bulk-delete`,
      { method: "POST", body: { artworkIds } },
    );
  },

  /**
   * The CSV import's bulk write. A row the server refuses lands in `rejected`
   * (its index in the POSTED array, plus the failed fields) and the rest of
   * the batch still lands — that 200-with-holes is why this returns the
   * outcome rather than throwing.
   */
  async createArtworks(
    collectionId: string,
    rows: unknown[],
  ): Promise<ArtworkImportOutcome> {
    return apiRequest<ArtworkImportOutcome>(base(collectionId), {
      method: "POST",
      body: { rows },
    });
  },
};
