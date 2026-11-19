import { z } from "zod";
import type { Selection } from "../types";
import { passwordSchema } from "./catalogue";
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
 * `isPublic` and `password` are the publish slice's two fields. Visibility is
 * independent of the source Catalogue's: a private Catalogue may have a public
 * Selection. A string sets or overwrites the password, `null` clears it, and
 * either write revokes every grant the Selection has issued — the same contract
 * a Catalogue's settings follow.
 */
export const selectionUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Selection name is required").optional(),
    description: z.string().trim().min(1).nullable().optional(),
    isPublic: z.boolean().optional(),
    password: passwordSchema.nullable().optional(),
  })
  .strict();

export type SelectionUpdatePayload = z.infer<typeof selectionUpdateSchema>;

/**
 * POST /selections/{sid}/unlock. An attempt at a protected Selection's
 * password, from the lock screen.
 *
 * Deliberately NOT `passwordSchema`: any non-blank string is a fair guess, and
 * a short one is a wrong password rather than a malformed request — the route
 * answers `invalid-password` for both. This mirrors the Catalogue's unlock
 * schema exactly; the Selection's gate is its own, not a second copy of the
 * request rules.
 */
export const selectionUnlockSchema = z
  .object({
    password: z.string().min(1, "Enter the selection's password"),
  })
  .strict();

export type SelectionUnlockPayload = z.infer<typeof selectionUnlockSchema>;

/**
 * The public Selection document: what a visitor's page may know about it.
 *
 * Deliberately smaller than `selectionReadSchema`. There is no `catalogueId`,
 * because the source Catalogue's id is a different address and often a private
 * one; there is no password flag, because whether a password is set is a
 * member fact. The strict object is what makes those omissions a parse failure
 * rather than a silently stripped key.
 */
export const selectionPublicDocumentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    isPublic: z.boolean(),
  })
  .strict();

export type SelectionPublicDocument = z.infer<
  typeof selectionPublicDocumentSchema
>;

/**
 * GET /selections/{sid}. The Selection plus the source Catalogue's **name
 * only** — never its id or address — and the presentation it inherits.
 *
 * `skin` and `skinOptions` are the source Catalogue's, raw: the web resolves
 * them through `resolveSkin`/`resolveSkinOptions`, exactly as it does for a
 * Catalogue, so a Selection renders in the Catalogue's skin and options
 * without the API knowing what a skin is.
 */
export const selectionPublicReadSchema = z
  .object({
    selection: selectionPublicDocumentSchema,
    catalogueName: z.string(),
    skin: z.string().optional(),
    skinOptions: z
      .record(z.string(), z.union([z.boolean(), z.number(), z.string()]))
      .optional(),
  })
  .strict();

export type SelectionPublicRead = z.infer<typeof selectionPublicReadSchema>;
