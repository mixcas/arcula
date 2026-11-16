/**
 * The access service: the read the settings card renders, and the ways access
 * changes — transfer, removal and leaving.
 *
 * `GET /catalogues/{cid}/access` is the one source of the caller's role on an
 * administrative screen — the dashboard row's `role` is a badge, not this. The
 * response is parsed through the shared access schema, so a reshaped member or
 * invitation fails at the boundary rather than rendering a nameless row.
 *
 * Removal and leaving answer no document worth reading: the fact is the row
 * they deleted. The two literal answers are parsed all the same, so a route
 * that stops confirming the write cannot pass silently. Transfer answers the
 * confirmation plus whether the notice reached the new owner — the transfer is
 * committed either way.
 */

import { z } from "zod";
import {
  catalogueAccessSchema,
  catalogueTransferResponseSchema,
  type CatalogueAccess,
  type CatalogueTransferResponse,
} from "@arcula/shared";
import { apiRequest } from "./api";

const BASE = "/api/v1/catalogues";

const cataloguePath = (catalogueId: string): string =>
  `${BASE}/${encodeURIComponent(catalogueId)}`;

const removedSchema = z.object({ removed: z.literal(true) });
const leftSchema = z.object({ left: z.literal(true) });

export const accessService = {
  /** Who has access, and — to the owner — every pending invitation. */
  async getAccess(catalogueId: string): Promise<CatalogueAccess> {
    const row = await apiRequest<unknown>(
      `${cataloguePath(catalogueId)}/access`,
    );
    return catalogueAccessSchema.parse(row);
  },

  /**
   * Owner-only. The target is the account whose membership row goes; a row
   * already gone (a stale card) is the API's `409`, left for the card to
   * surface with a refresh.
   */
  async removeCollaborator(catalogueId: string, userId: string): Promise<void> {
    const row = await apiRequest<unknown>(
      `${cataloguePath(catalogueId)}/collaborators/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    removedSchema.parse(row);
  },

  /**
   * The collaborator's own exit. `/me` is the caller's membership whatever its
   * id is, so no account id travels from here.
   */
  async leaveCatalogue(catalogueId: string): Promise<void> {
    const row = await apiRequest<unknown>(
      `${cataloguePath(catalogueId)}/collaborators/me`,
      { method: "DELETE" },
    );
    leftSchema.parse(row);
  },

  /**
   * Owner-only: transfer the catalogue to a collaborator. Immediate — the answer
   * is the confirmation, not a pending offer — and `emailSent` only says
   * whether the new owner was notified. A target who is not a collaborator (or
   * is the owner) is the API's `409`, for the card to show with a refresh.
   */
  async transferCatalogue(
    catalogueId: string,
    userId: string,
  ): Promise<CatalogueTransferResponse> {
    const row = await apiRequest<unknown>(
      `${cataloguePath(catalogueId)}/transfer`,
      { method: "POST", body: { userId } },
    );
    return catalogueTransferResponseSchema.parse(row);
  },
};
