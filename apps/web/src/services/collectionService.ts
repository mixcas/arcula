/**
 * The collection service layer.
 *
 * One HTTP call per operation, through `apiRequest`; GET bodies are parsed
 * through `collectionReadSchema` (the wire contract) so a server reshape is
 * a parse error at the boundary, not a render of a half-shaped document.
 * Writes return the server's answer parsed the same way.
 */

import {
  collectionReadSchema,
  type Collection,
  type CollectionCreatePayload,
  type CollectionUpdatePayload,
} from "@arcula/shared";
import { ApiRequestError, apiRequest } from "./api";

const BASE = "/api/v1/collections";

export const collectionService = {
  /** The collections the session owns — the /manage dashboard. */
  async getUserCollections(): Promise<Collection[]> {
    const rows = await apiRequest<unknown[]>(BASE);
    return rows.map((row) => collectionReadSchema.parse(row));
  },

  /**
   * One collection, by id. A missing collection resolves `null`; a private
   * one the caller does not own rejects (403) — the public views map that
   * refusal to their `private` state, so it must stay an error.
   */
  async getCollection(id: string): Promise<Collection | null> {
    try {
      const row = await apiRequest<unknown>(`${BASE}/${id}`);
      return collectionReadSchema.parse(row);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        return null;
      }
      throw err;
    }
  },

  /**
   * Create. The id is minted server-side; the answer is the created
   * collection, so the redirect needs no second read. Reaching the tier cap
   * rejects with 409 `limit-reached` — its message is the one the form shows.
   */
  async createCollection(
    payload: Pick<CollectionCreatePayload, "name" | "description">,
  ): Promise<Collection> {
    const row = await apiRequest<unknown>(BASE, {
      method: "POST",
      body: payload,
    });
    return collectionReadSchema.parse(row);
  },

  /**
   * The settings save. `null` clears a field; an absent one is left alone —
   * the settings page builds the payload so that only the changed keys are
   * present.
   */
  async updateCollection(
    id: string,
    payload: CollectionUpdatePayload,
  ): Promise<Collection> {
    const row = await apiRequest<unknown>(`${BASE}/${id}`, {
      method: "PATCH",
      body: payload,
    });
    return collectionReadSchema.parse(row);
  },
};
