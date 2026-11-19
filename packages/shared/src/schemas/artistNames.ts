import { z } from "zod";

/**
 * GET /api/v1/artist-names. The caller's artist vocabulary on the wire: the
 * canonical spellings alone, already ordered by the server. Counts are an
 * ordering input and never serialized — the dropdown shows the name alone.
 *
 * Non-blank by contract: the stored spelling is passed through untransformed,
 * but a name whose trimmed form is empty is a failed parse on both sides rather
 * than an empty row in the dropdown.
 */
export const artistNamesSchema = z.array(
  z.string().refine((name) => name.trim() !== "", {
    message: "Artist name must not be blank",
  }),
);

export type ArtistNames = z.infer<typeof artistNamesSchema>;
