/**
 * The artwork service layer.
 *
 * Reads parse through `artworkReadSchema` (the wire contract); writes are one
 * HTTP call each — a save is one server-side transaction (fields +
 * staged-entry promotion), so there is nothing for the client to sequence.
 *
 * The 404s on the single-artwork reads are the contract, not a failure:
 * for a visitor, a private work and a deleted work both answer 404 —
 * saying which was refused would be a disclosure — and the public views
 * map that to their not-found state.
 */

import {
  artworkPageSchema,
  artworkReadSchema,
  artworkSearchSuffix,
  type Artwork,
  type ArtworkCreatePayload,
  type ArtworkImportOutcome,
  type ArtworkUpdatePayload,
} from "@arcula/shared";
import { ApiRequestError, apiRequest } from "./api";

const base = (catalogueId: string) =>
  `/api/v1/catalogues/${catalogueId}/artworks`;

export const artworkService = {
  /**
   * The catalogue's live works. The optional `query` is a Catalogue search:
   * a member-only condition on the same read, so the URL carries `q` only when
   * there is something to search for. The public views and the PDF call this
   * with no query at all.
   *
   * The read answers a page envelope; the app renders the page whole, so it
   * takes `artworks` and ignores the paging facts it did not ask for. An
   * absent `limit` is what makes that page every match — the web's behaviour
   * is the contract's default, not a special case here.
   */
  async getCatalogueArtworks(
    catalogueId: string,
    query = "",
  ): Promise<Artwork[]> {
    const trimmed = query.trim();
    const suffix = artworkSearchSuffix(trimmed);
    const page = await apiRequest<unknown>(`${base(catalogueId)}${suffix}`);
    return artworkPageSchema.parse(page).artworks;
  },

  /**
   * One work, by id. A work that does not exist — or that a visitor may not
   * see (private or deleted) — resolves `null`. A private *catalogue*
   * rejects (403), which the public views map to their private state.
   */
  async getArtwork(
    catalogueId: string,
    artworkId: string,
  ): Promise<Artwork | null> {
    try {
      const row = await apiRequest<unknown>(
        `${base(catalogueId)}/${artworkId}`,
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
    catalogueId: string,
    payload: ArtworkCreatePayload,
  ): Promise<Artwork> {
    const row = await apiRequest<unknown>(base(catalogueId), {
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
    catalogueId: string,
    artworkId: string,
    payload: ArtworkUpdatePayload,
  ): Promise<Artwork> {
    const row = await apiRequest<unknown>(`${base(catalogueId)}/${artworkId}`, {
      method: "PATCH",
      body: payload,
    });
    return artworkReadSchema.parse(row);
  },

  /**
   * The catalogue's deleted works, most recently deleted first. This is the
   * Deleted view's read and it sits one level above `base`: a static segment
   * under `/artworks` would be shadowed by the single-artwork route on the
   * server. Members only.
   */
  async getDeletedArtworks(catalogueId: string): Promise<Artwork[]> {
    const rows = await apiRequest<unknown[]>(
      `/api/v1/catalogues/${catalogueId}/deleted-artworks`,
    );
    return rows.map((row) => artworkReadSchema.parse(row));
  },

  /**
   * Bring one deleted work back. The server clears the deletion stamp and
   * answers at once; the views refetch rather than splicing the row out.
   */
  async restoreArtwork(
    catalogueId: string,
    artworkId: string,
  ): Promise<{ restored: true }> {
    return apiRequest<{ restored: true }>(
      `${base(catalogueId)}/${artworkId}/restore`,
      { method: "POST" },
    );
  },

  /**
   * Bring several deleted works back in one call. The server clears the stamp
   * on the rows the call actually moves and answers that count — a live or
   * foreign id is not counted — and the view refetches rather than splicing.
   */
  async bulkRestoreArtworks(
    catalogueId: string,
    artworkIds: string[],
  ): Promise<{ restored: number }> {
    return apiRequest<{ restored: number }>(
      `${base(catalogueId)}/bulk-restore`,
      { method: "POST", body: { artworkIds } },
    );
  },

  /**
   * The batch soft delete behind the table's selection. The server stamps
   * `deletedAt` and answers the count — the table refetches, it does not
   * splice.
   */
  async softDeleteArtworks(
    catalogueId: string,
    artworkIds: string[],
  ): Promise<{ deleted: number }> {
    return apiRequest<{ deleted: number }>(`${base(catalogueId)}/bulk-delete`, {
      method: "POST",
      body: { artworkIds },
    });
  },

  /**
   * The CSV import's bulk write. A row the server refuses lands in `rejected`
   * (its index in the POSTED array, plus the failed fields) and the rest of
   * the batch still lands — that 200-with-holes is why this returns the
   * outcome rather than throwing.
   */
  async createArtworks(
    catalogueId: string,
    rows: unknown[],
  ): Promise<ArtworkImportOutcome> {
    // The import route, NOT `base(catalogueId)`: that one is the
    // single-artwork create route, which validates the body as one artwork
    // and 400s a `{rows}` envelope with "artworkId/title/artistName:
    // expected string, received undefined" — a validation error that says
    // nothing about the wrong URL. The API suite pins the route and the
    // component suites stub this method, so tests/artworkService.test.ts is
    // the only thing that checks this seam.
    return apiRequest<ArtworkImportOutcome>(
      `/api/v1/catalogues/${catalogueId}/import/csv`,
      {
        method: "POST",
        body: { rows },
      },
    );
  },
};
