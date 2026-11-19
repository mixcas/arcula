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
  selectionReadSchema,
  type Selection,
  type SelectionCreatePayload,
  type SelectionPageRow,
  type SelectionUpdatePayload,
} from "@arcula/shared";
import { ApiRequestError, apiRequest } from "./api";

const base = (catalogueId: string) =>
  `/api/v1/catalogues/${catalogueId}/selections`;

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
};
