import { z } from "zod";
import { MINTED_ID_RE } from "./artwork";

/**
 * The /api/v1 collection payloads (Phase 3 S5, plan §7). The form side of
 * these stays in the web app; what is shared is the JSON the routes
 * validate — the same reason the artwork save payloads live next to
 * `artworkSchema` rather than in the route file.
 */

/**
 * POST /collections. The id is minted server-side — the old `addDoc()` had
 * no caller-supplied id, and the client only ever sent name/description.
 */
export const collectionCreateSchema = z.object({
  name: z.string().trim().min(1, "Collection name is required"),
  description: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  // Collections are public by default — the service layer stamped it on
  // every create; the schema default keeps every write path agreeing.
  isPublic: z.boolean().default(true),
});

export type CollectionCreatePayload = z.infer<typeof collectionCreateSchema>;

// In a JSON payload a field is either a value, `null` (clear), or absent
// (leave alone) — JSON has no `deleteField()` sentinel, and `null` is what
// replaces it (the same contract the artwork PATCH uses). A string must be
// non-blank: clearing is the job of `null`.
const clearableText = z.string().trim().min(1).nullable().optional();

/**
 * PATCH /collections/{cid}. The settings form always sends `name` and
 * `isPublic` — they are the fields it cannot omit — and the rest only when
 * they differ from what it loaded, which is what makes absent-key-leave-alone
 * load-bearing here.
 */
export const collectionUpdateSchema = z.object({
  name: z.string().trim().min(1, "Collection name is required"),
  isPublic: z.boolean(),
  description: clearableText,
  skin: clearableText,
  skinOptions: z
    .record(z.string(), z.union([z.boolean(), z.number(), z.string()]))
    .nullable()
    .optional(),
});

export type CollectionUpdatePayload = z.infer<typeof collectionUpdateSchema>;

/**
 * POST /collections/{cid}/import/csv. The envelope is deliberately loose
 * (`rows` is an array of unknowns): a row that fails the shared
 * `artworkSchema` belongs in the 200 response's `rejected`, not in a 400
 * that fails the whole batch — the review step already told the user which
 * rows are broken, and the rest of the file still has to land.
 */
export const artworkImportSchema = z.object({
  rows: z.array(z.unknown()),
});

export type ArtworkImportPayload = z.infer<typeof artworkImportSchema>;

/**
 * POST /collections/{cid}/artworks/bulk-delete. The ids are the ones the
 * client minted (the table lists them), so the shared minted-id rule is
 * the right one to check against.
 */
export const artworkBulkDeleteSchema = z.object({
  artworkIds: z
    .array(z.string().regex(MINTED_ID_RE, "Invalid artwork id"))
    .min(1, "Select at least one artwork"),
});

export type ArtworkBulkDeletePayload = z.infer<typeof artworkBulkDeleteSchema>;
