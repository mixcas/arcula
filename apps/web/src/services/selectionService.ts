/**
 * The Selection service layer.
 *
 * One object, one HTTP call per operation, through `apiRequest`. Every read is
 * parsed through the shared wire schema, so a server reshape is a parse error
 * at the boundary rather than a half-shaped document in a render. A single
 * Selection answers `null` on 404; a 403 stays an error, because the public
 * layer maps it to private or locked.
 *
 * No data-fetching library: components call these in effects and handlers, as
 * `catalogueService` and `artworkService` do.
 */

import {
  selectionPageSchema,
  selectionPublicReadSchema,
  selectionReadSchema,
  selectionWorksReadSchema,
  type Artwork,
  type Selection,
  type SelectionCreatePayload,
  type SelectionPageRow,
  type SelectionPublicRead,
  type SelectionUpdatePayload,
} from "@arcula/shared";
import { ApiRequestError, apiRequest } from "./api";

const base = (catalogueId: string) =>
  `/api/v1/catalogues/${catalogueId}/selections`;

const publicBase = "/api/v1/selections";

export const selectionService = {
  /** The Catalogue's live Selections, name-ordered, each with its Work count. */
  async list(catalogueId: string): Promise<SelectionPageRow[]> {
    const body = await apiRequest<unknown>(base(catalogueId));
    return selectionPageSchema.parse(body).selections;
  },

  /**
   * One Selection, by id, as a member read. A missing or deleted Selection
   * resolves `null`; a 403 stays an error.
   */
  async get(
    catalogueId: string,
    selectionId: string,
  ): Promise<Selection | null> {
    try {
      const row = await apiRequest<unknown>(
        `${base(catalogueId)}/${selectionId}`,
      );
      return selectionReadSchema.parse(row);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        return null;
      }
      throw err;
    }
  },

  /** Create. The id is minted server-side; the answer is the created document. */
  async create(
    catalogueId: string,
    payload: Pick<SelectionCreatePayload, "name" | "description">,
  ): Promise<Selection> {
    const row = await apiRequest<unknown>(base(catalogueId), {
      method: "POST",
      body: payload,
    });
    return selectionReadSchema.parse(row);
  },

  /**
   * The settings save. `null` clears the description; an absent key leaves it
   * alone — the page builds the payload so only the changed keys are present.
   */
  async update(
    catalogueId: string,
    selectionId: string,
    payload: SelectionUpdatePayload,
  ): Promise<Selection> {
    const row = await apiRequest<unknown>(
      `${base(catalogueId)}/${selectionId}`,
      { method: "PATCH", body: payload },
    );
    return selectionReadSchema.parse(row);
  },

  /** Delete. The answer is a `204`, so the act's fact is the resolved call. */
  async remove(catalogueId: string, selectionId: string): Promise<void> {
    await apiRequest<void>(`${base(catalogueId)}/${selectionId}`, {
      method: "DELETE",
    });
  },

  /**
   * The Selection's works, in the curator's order.
   *
   * This is the public address, deliberately: the read resolves the session
   * optionally and answers the member audience to a member of the source
   * Catalogue and the visitor audience to everyone else. The manage page and
   * the visitor page therefore parse one envelope from one route, and the
   * server — not the page — decides what a Draft or a document looks like.
   */
  async getWorks(selectionId: string): Promise<Artwork[]> {
    const body = await apiRequest<unknown>(
      `${publicBase}/${selectionId}/artworks`,
    );
    return selectionWorksReadSchema.parse(body).artworks;
  },

  /**
   * Append works, in the order they were checked. A work already in the
   * Selection is skipped by the server, so a repeat is harmless. The answer is
   * the updated ordered list.
   */
  async addWorks(
    catalogueId: string,
    selectionId: string,
    artworkIds: string[],
  ): Promise<Artwork[]> {
    const body = await apiRequest<unknown>(
      `${base(catalogueId)}/${selectionId}/works`,
      { method: "POST", body: { artworkIds } },
    );
    return selectionWorksReadSchema.parse(body).artworks;
  },

  /**
   * State the whole list: the reorder and the remove. An empty list empties the
   * Selection. The answer is the updated ordered list.
   */
  async replaceWorks(
    catalogueId: string,
    selectionId: string,
    artworkIds: string[],
  ): Promise<Artwork[]> {
    const body = await apiRequest<unknown>(
      `${base(catalogueId)}/${selectionId}/works`,
      { method: "PUT", body: { artworkIds } },
    );
    return selectionWorksReadSchema.parse(body).artworks;
  },

  /**
   * One Selection at its public address. The read is session-optional: a
   * visitor sees a public document, a member may preview a private one, and the
   * API — not this client — decides which. A missing, deleted or private
   * Selection resolves `null`; a protected one rejects `403 password-required`,
   * which the public layer maps to the lock screen.
   */
  async getPublicSelection(id: string): Promise<SelectionPublicRead | null> {
    try {
      const body = await apiRequest<unknown>(`${publicBase}/${id}`);
      return selectionPublicReadSchema.parse(body);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        return null;
      }
      throw err;
    }
  },

  /**
   * The lock screen's attempt: a right password sets the Selection's grant
   * cookie and the ordinary read then succeeds. A wrong one rejects `403
   * invalid-password`; one too many failures from this address rejects `429
   * too-many-attempts`; a Selection that is not protected rejects `409`.
   */
  async unlockSelection(id: string, password: string): Promise<void> {
    await apiRequest<unknown>(`${publicBase}/${id}/unlock`, {
      method: "POST",
      body: { password },
    });
  },
};
