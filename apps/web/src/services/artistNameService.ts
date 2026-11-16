/**
 * The Artist Name suggestions service.
 *
 * One read: the caller's own artist vocabulary, parsed through the shared wire
 * schema. It is caller-scoped rather than catalogue-scoped — the list is the
 * widest set the caller may already read — so the URL names no catalogue.
 */

import { artistNamesSchema, type ArtistNames } from "@arcula/shared";
import { apiRequest } from "./api";

export const artistNameService = {
  /** The caller's artist names, already collapsed and ordered by the server. */
  async getArtistNames(): Promise<ArtistNames> {
    return artistNamesSchema.parse(
      await apiRequest<unknown>("/api/v1/artist-names"),
    );
  },
};
