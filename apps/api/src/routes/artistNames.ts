// GET /api/v1/artist-names — the caller's artist vocabulary, for the artwork
// form's Artist Name suggestions.
//
// Deliberately not nested under /collections/{cid}: the resource is the
// caller's vocabulary, not a collection's, and the caller comes from the
// session. The module owns the aggregate and the collapse; this route owns the
// wire and the status code, so a caller with no session is the one refusal and
// a caller with no collections is an empty list, not an error.

import { Hono } from "hono";
import { artistNamesSchema } from "@arcula/shared";
import { readArtistNames } from "../artistNames";
import { requireSession } from "../session";

export const artistNameRoutes = new Hono();

artistNameRoutes.get("/artist-names", requireSession, async (c) => {
  const names = await readArtistNames(c.get("user").id);
  // Parsed through the shared schema, so the client and the server read the
  // same contract and a blank or malformed name fails here rather than in a
  // dropdown.
  return c.json(artistNamesSchema.parse(names));
});
