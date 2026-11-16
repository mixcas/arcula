import { z } from "zod";
import type { CatalogueKind } from "../types";
import { MINTED_ID_RE } from "./artwork";

/**
 * What a catalogue is — an artist's Portfolio, a collector's Collection or a
 * gallery's Inventory — as ADR-0010 names the three. The row's meaning is
 * fixed at creation; only the create schema accepts it.
 */
export const catalogueKindSchema = z.enum([
  "portfolio",
  "collection",
  "inventory",
]);

// The enum and the client type are the same three words. The first direction
// catches a member added to one and not the other; the second catches a word
// the type knows and the schema refuses.
type KindEnumIsKind =
  z.output<typeof catalogueKindSchema> extends CatalogueKind
    ? CatalogueKind extends z.output<typeof catalogueKindSchema>
      ? true
      : never
    : never;
const kindEnumIsKind: KindEnumIsKind = true;
void kindEnumIsKind;

/**
 * The /api/v1 catalogue payloads. The form side of
 * these stays in the web app; what is shared is the JSON the routes
 * validate — the same reason the artwork save payloads live next to
 * `artworkSchema` rather than in the route file.
 */

/**
 * POST /catalogues. The id is minted server-side; the client sends only
 * name/description — and the kind, once, at creation. An absent kind is
 * `collection`: the shape every pre-kind client sends, and the collector's
 * case the product started with.
 */
export const catalogueCreateSchema = z.object({
  name: z.string().trim().min(1, "Catalogue name is required"),
  kind: catalogueKindSchema.default("collection"),
  description: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  // Catalogues are public by default — the service layer stamped it on
  // every create; the schema default keeps every write path agreeing.
  isPublic: z.boolean().default(true),
});

export type CatalogueCreatePayload = z.infer<typeof catalogueCreateSchema>;

// In a JSON payload a field is either a value, `null` (clear), or absent
// (leave alone) — the same contract the artwork PATCH uses. A string must be
// non-blank: clearing is the job of `null`.
const clearableText = z.string().trim().min(1).nullable().optional();

/**
 * A catalogue password, as both sides enforce it: eight characters, no
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
 * PATCH /catalogues/{cid}. Every field is optional, and an absent key leaves
 * the column alone: the settings tabs send only what that tab changed, so the
 * contract no longer exempts any field from the rule that absent leaves alone.
 * A save that names nothing is a valid, successful no-op — no column changes,
 * and the record's timestamp is not moved. A present key validates as before:
 * a name still trims and still cannot be blank, and neither field can be
 * cleared.
 *
 * `password` follows the same contract, with the three meanings the settings
 * form needs: a string sets (or overwrites) it, `null` removes it, and an
 * absent key leaves it alone. Setting and overwriting are the same write, and
 * every password write revokes the catalogue's outstanding grants.
 *
 * `kind` is deliberately absent: a catalogue never changes meaning underneath
 * the works it holds, so a header naming it is dropped as an unknown key.
 */
export const catalogueUpdateSchema = z.object({
  name: z.string().trim().min(1, "Catalogue name is required").optional(),
  isPublic: z.boolean().optional(),
  description: clearableText,
  skin: clearableText,
  skinOptions: z
    .record(z.string(), z.union([z.boolean(), z.number(), z.string()]))
    .nullable()
    .optional(),
  password: passwordSchema.nullable().optional(),
});

export type CatalogueUpdatePayload = z.infer<typeof catalogueUpdateSchema>;

/**
 * POST /catalogues/{cid}/unlock. An attempt at a Protected catalogue's
 * password, from the lock screen.
 *
 * Deliberately NOT `passwordSchema`: any non-blank string is a fair guess, and
 * a short one is a wrong password rather than a malformed request — the route
 * answers `invalid-password` for both, so a guess that cannot be right is not
 * singled out from one that merely is not.
 */
export const catalogueUnlockSchema = z.object({
  password: z.string().min(1, "Enter the catalogue's password"),
});

export type CatalogueUnlockPayload = z.infer<typeof catalogueUnlockSchema>;

/**
 * POST /catalogues/{cid}/import/csv. The envelope is deliberately loose
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
 * POST /catalogues/{cid}/artworks/bulk-delete. The ids are the ones the
 * client minted (the table lists them), so the shared minted-id rule is
 * the right one to check against.
 */
export const artworkBulkDeleteSchema = z.object({
  artworkIds: z
    .array(z.string().regex(MINTED_ID_RE, "Invalid artwork id"))
    .min(1, "Select at least one artwork"),
});

export type ArtworkBulkDeletePayload = z.infer<typeof artworkBulkDeleteSchema>;

/**
 * POST /catalogues/{cid}/artworks/bulk-restore. The same selection the batch
 * soft delete takes — the ids the client minted — so the two halves of the
 * Deleted view share one request shape and one validation rule. The answer is
 * `{ restored: n }`: how many rows this call actually moved.
 */
export const artworkBulkRestoreSchema = artworkBulkDeleteSchema;

export type ArtworkBulkRestorePayload = z.infer<
  typeof artworkBulkRestoreSchema
>;
