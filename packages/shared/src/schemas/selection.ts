import { z } from "zod";
import type { Selection } from "../types";
import { wireTimestamp } from "./document";

/**
 * A Selection's payloads, and the wire documents the API answers.
 *
 * The request schemas are strict: a Selection create or update names exactly
 * the fields this slice owns, and an unknown key is a validation error rather
 * than a silently dropped write. That is a deliberate divergence from the
 * Catalogue's request schemas, which strip `kind` on update.
 *
 * The read schemas follow the package's convention: the serializer's shape,
 * re-declared so a server change is a parse error at the service boundary.
 * They never carry `passwordHash`; the member read carries only its presence as
 * `isPasswordProtected`.
 */

/**
 * GET /catalogues/{cid}/selections/{sid}. The member read — `createdAt` and
 * `updatedAt` are always emitted, and blank text is an absent key rather than
 * `null`. `isPasswordProtected` is the member's one-bit answer about the
 * password, derived from the hash's presence; the hash itself never reaches the
 * wire.
 */
export const selectionReadSchema = z.object({
  id: z.string(),
  catalogueId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  isPublic: z.boolean(),
  isPasswordProtected: z.boolean().optional(),
  createdAt: wireTimestamp,
  updatedAt: wireTimestamp,
});

export type SelectionRead = z.infer<typeof selectionReadSchema>;

// One direction only: anything the service parses flows into the existing
// client type, while the client type stays looser than the wire.
type SelectionWireIsSelection = SelectionRead extends Selection ? true : never;
const selectionWireIsSelection: SelectionWireIsSelection = true;
void selectionWireIsSelection;

/**
 * One row of the member list: the read document plus the live-work count. The
 * count is the answer to "how many works would a reader see", so a work
 * deleted in its Catalogue is not counted and a Draft is.
 */
export const selectionRowSchema = selectionReadSchema.extend({
  workCount: z.number().int().min(0),
});

export type SelectionPageRow = z.infer<typeof selectionRowSchema>;

/**
 * GET /catalogues/{cid}/selections. The page envelope, as the artwork list
 * answers one: an object rather than a bare array, so a count or cursor can
 * join it later without a breaking change.
 */
export const selectionPageSchema = z.object({
  selections: z.array(selectionRowSchema),
});

export type SelectionPage = z.infer<typeof selectionPageSchema>;

/**
 * POST /catalogues/{cid}/selections. The id is minted server-side; the caller
 * sends a name and an optional description. A blank name is refused, not
 * stored, and a blank description is absent rather than an empty string.
 * `isPublic` is present for the contract's shape but defaults to false: a new
 * Selection is private unless the caller deliberately says otherwise.
 */
export const selectionCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Selection name is required"),
    description: z
      .string()
      .trim()
      .transform((value) => (value === "" ? undefined : value))
      .optional(),
    isPublic: z.boolean().default(false),
  })
  .strict();

export type SelectionCreatePayload = z.infer<typeof selectionCreateSchema>;

/**
 * PATCH /catalogues/{cid}/selections/{sid}. Every field is optional: present
 * sets (or, as `null`, clears), absent leaves the column. `description` is the
 * one clearable text field here; a blank string is not a clear, it is a
 * mistake, so only `null` empties it.
 *
 * Visibility, the password and the works payload are deliberately absent:
 * the first two belong to the publish slice and the third to curation.
 */
export const selectionUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Selection name is required").optional(),
    description: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export type SelectionUpdatePayload = z.infer<typeof selectionUpdateSchema>;
