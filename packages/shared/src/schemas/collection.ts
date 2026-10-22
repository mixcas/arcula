import { z } from "zod";
import { MINTED_ID_RE } from "./artwork";

/**
 * The /api/v1 collection payloads. The form side of
 * these stays in the web app; what is shared is the JSON the routes
 * validate — the same reason the artwork save payloads live next to
 * `artworkSchema` rather than in the route file.
 */

/**
 * POST /collections. The id is minted server-side; the client sends only
 * name/description.
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
// (leave alone) — the same contract the artwork PATCH uses. A string must be
// non-blank: clearing is the job of `null`.
const clearableText = z.string().trim().min(1).nullable().optional();

/**
 * A collection password, as both sides enforce it: eight characters, no
 * complexity rule. Deliberately not trimmed — a space is a character somebody
 * chose, and trimming would silently change the secret they typed.
 *
 * The same rule runs in the settings form (where a confirmation also has to
 * match) and in the PATCH body: the client's check is a courtesy, and the
 * server's is the one that decides.
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters");

/**
 * PATCH /collections/{cid}. The settings form always sends `name` and
 * `isPublic` — they are the fields it cannot omit — and the rest only when
 * they differ from what it loaded, which is what makes absent-key-leave-alone
 * load-bearing here.
 *
 * `password` follows the same contract, with the three meanings the settings
 * form needs: a string sets (or overwrites) it, `null` removes it, and an
 * absent key leaves it alone. Setting and overwriting are the same write, and
 * every password write revokes the collection's outstanding grants.
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
  password: passwordSchema.nullable().optional(),
});

export type CollectionUpdatePayload = z.infer<typeof collectionUpdateSchema>;

/**
 * POST /collections/{cid}/unlock. An attempt at a Protected collection's
 * password, from the lock screen.
 *
 * Deliberately NOT `passwordSchema`: any non-blank string is a fair guess, and
 * a short one is a wrong password rather than a malformed request — the route
 * answers `invalid-password` for both, so a guess that cannot be right is not
 * singled out from one that merely is not.
 */
export const collectionUnlockSchema = z.object({
  password: z.string().min(1, "Enter the collection's password"),
});

export type CollectionUnlockPayload = z.infer<typeof collectionUnlockSchema>;

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
 * The 200 response of the import route: how many rows landed, and which
 * posted rows the server refused and why. `row` is the index into the POSTED
 * `rows` array — the selected rows, not the lines of the CSV file — so the
 * client can point the message at the right review row without re-reading the
 * file.
 */
export const artworkImportOutcomeSchema = z.object({
  inserted: z.number().int().min(0),
  rejected: z.array(
    z.object({
      row: z.number().int().min(0),
      errors: z.record(z.string(), z.string()),
    }),
  ),
});

export type ArtworkImportOutcome = z.infer<typeof artworkImportOutcomeSchema>;

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
