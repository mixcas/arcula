import { z } from "zod";
import type { Artwork } from "../types";

/**
 * Validation and payload shaping for the artwork form, shared by
 * ArtworkAddPage and ArtworkEditPage so both write identical documents for
 * identical input.
 *
 * One schema does three jobs that used to be spread across both pages as
 * hand-rolled code: it validates, it coerces (via the transforms below), and
 * its output *is* the payload — `@mantine/form` feeds `z.output` to the submit
 * handler through `transformValues`, so there is no second conversion step.
 *
 * This file is the pure core of the artwork schema; the PATCH-payload seam
 * (`toArtworkUpdate`) stayed in `apps/web/src/schemas/artwork.ts`, next to the
 * Edit form that supplies it the loaded values it clears against. The API
 * validates and writes with these same functions.
 */

/** Blank text becomes `undefined` so an untouched field is never written. */
const blankText = (value: string): string | undefined =>
  value.trim() === "" ? undefined : value;

/**
 * Optional free text: trimmed, and dropped entirely when left blank.
 *
 * Also covers the money fields, which are stored as strings and are
 * deliberately not format-checked — see `Artwork.acquisitionPrice`.
 */
const optionalText = z.string().trim().transform(blankText).optional();

/**
 * Optional `YYYY-MM-DD` date.
 *
 * This is the only date-validated field because it is the only one bound to a
 * `DateInput`, and therefore the only one guaranteed to be a full date.
 * `dateOfCreation` stays free text on purpose — real artworks carry partial
 * values like "1889" or "circa 1889". `z.iso.date()` also rejects impossible
 * calendar dates such as 2023-02-30, not just malformed ones.
 *
 * `null` has to be in the union because that is what `clearable` makes
 * DateInput emit — both from the clear button and from backspacing the text to
 * empty. Without it, clearing the field fails validation with "Invalid input".
 */
const optionalDate = z
  .union([z.iso.date({ error: "Enter a valid date" }), z.literal(""), z.null()])
  .transform((value) => (value === "" || value === null ? undefined : value))
  .optional();

export const artworkSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  artistName: z.string().trim().min(1, "Artist name is required"),
  serie: optionalText,
  dateOfCreation: optionalText,
  media: optionalText,
  dimensions: optionalText,
  editions: optionalText,
  acquisitionDate: optionalDate,
  acquisitionPrice: optionalText,
  placeOfOrigin: optionalText,
  provenance: optionalText,
  notes: optionalText,
  condition: optionalText,
  currentValue: optionalText,
  // Per-artwork public visibility, independent of the collection's own flag.
  // Public by default — a work is visible to visitors unless the owner
  // explicitly turns it off in the Add/Edit form.
  isPublic: z.boolean().default(true),
});

/**
 * What the inputs hold while the form is open.
 *
 * Hand-written rather than derived from `z.input<typeof artworkSchema>` so that
 * every text field is a required `string`: an optional field would let a value
 * be `undefined`, and `value={undefined}` makes a React input uncontrolled.
 *
 * `acquisitionDate` is the one exception to "always a string", and widening it
 * is the point: a `clearable` DateInput really does emit `null`, so a `string`
 * type here would be a claim the component does not honour.
 */
export interface ArtworkFormValues {
  title: string;
  artistName: string;
  serie: string;
  dateOfCreation: string;
  media: string;
  dimensions: string;
  editions: string;
  acquisitionDate: string | null;
  acquisitionPrice: string;
  placeOfOrigin: string;
  provenance: string;
  notes: string;
  condition: string;
  currentValue: string;
  isPublic: boolean;
}

/** The trimmed, validated, API-ready subset of an artwork. */
export type ArtworkPayload = Partial<Omit<Artwork, "id">>;

// Compile-time guards, erased at build time. The first catches a schema that
// stops accepting what the inputs produce (e.g. a field widened to `unknown`);
// the second catches a schema whose output is no longer a writable artwork.
type SchemaAcceptsForm =
  ArtworkFormValues extends z.input<typeof artworkSchema> ? true : never;
type OutputIsWritable =
  z.output<typeof artworkSchema> extends ArtworkPayload ? true : never;
const schemaAcceptsForm: SchemaAcceptsForm = true;
const outputIsWritable: OutputIsWritable = true;
void schemaAcceptsForm;
void outputIsWritable;

export const EMPTY_ARTWORK_FORM: ArtworkFormValues = {
  title: "",
  artistName: "",
  serie: "",
  dateOfCreation: "",
  media: "",
  dimensions: "",
  editions: "",
  acquisitionDate: "",
  acquisitionPrice: "",
  placeOfOrigin: "",
  provenance: "",
  notes: "",
  condition: "",
  currentValue: "",
  isPublic: true,
};

// `EDITABLE_FIELDS` — the fields the edit form owns, the only ones that may
// be cleared on save — lives in `apps/web/src/schemas/artwork.ts`, where the
// `toArtworkUpdate` sentinel it feeds also lives.

/**
 * Remove the keys the schema resolved to `undefined`.
 *
 * JSON has no `undefined` — the wire carries a value, `null`, or an absent
 * key — so "unset" has to mean "the key is not there", not "the key is there
 * and holds undefined".
 */
const stripUndefined = (payload: Record<string, unknown>): ArtworkPayload =>
  Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );

/**
 * Validate form values and shape them into the API payload.
 * Wired to `useForm` as `transformValues`, so it only runs on a valid submit.
 */
export const toArtworkPayload = (values: ArtworkFormValues): ArtworkPayload =>
  stripUndefined(artworkSchema.parse(values));

/** Populate the form from a stored artwork. */
export const fromArtwork = (artwork: Artwork): ArtworkFormValues => ({
  title: artwork.title,
  artistName: artwork.artistName,
  serie: artwork.serie ?? "",
  dateOfCreation: artwork.dateOfCreation ?? "",
  media: artwork.media ?? "",
  dimensions: artwork.dimensions ?? "",
  editions: artwork.editions ?? "",
  acquisitionDate: artwork.acquisitionDate ?? "",
  acquisitionPrice: artwork.acquisitionPrice ?? "",
  placeOfOrigin: artwork.placeOfOrigin ?? "",
  provenance: artwork.provenance ?? "",
  notes: artwork.notes ?? "",
  condition: artwork.condition ?? "",
  currentValue: artwork.currentValue ?? "",
  // A stored work without the field predates the public default; treat it as
  // public, consistent with how new works are written.
  isPublic: artwork.isPublic ?? true,
});

// `toArtworkUpdate` — the PATCH-payload seam — lives in
// `apps/web/src/schemas/artwork.ts`, next to the Edit form that supplies it
// the loaded values a cleared field is matched against.

// ---------------------------------------------------------------------------
// API save payloads
//
// The form schemas above validate the inputs; these two validate the JSON a
// save request carries — the fields, plus the staged entries the API
// promotes into rows in the same transaction.
// ---------------------------------------------------------------------------

/**
 * A client-minted id: letters, digits, dash, underscore; nothing that could
 * carry a dot or a path separator. It is what an object-key segment must be,
 * and entry ids and artwork ids are both minted under it — the stage routes
 * apply the same rule to the ids they accept (one regex, shared).
 */
export const MINTED_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** One staged entry in a save payload. `name` is metadata only — never in a path. */
export const stagedEntrySchema = z.object({
  entryId: z.string().regex(MINTED_ID_RE, "Invalid entry id"),
  name: z.string().trim().min(1, "Name is required"),
});

export type StagedEntry = z.infer<typeof stagedEntrySchema>;

/**
 * POST …/artworks. The form's fields plus the client-minted artwork id and
 * the staged entries to promote in the same transaction.
 *
 * The payload carries no `order`: the array position IS the order — the
 * server assigns it from position, which is the client's existing
 * `reindexPhotos` contract ("array position is the truth") restated at the
 * boundary. A save cannot therefore express a duplicate or a gap; the
 * UNIQUE (artworkId, order) constraint is what turns a _concurrent_ race
 * into a hard error instead.
 */
export const artworkCreateSchema = artworkSchema.extend({
  artworkId: z.string().regex(MINTED_ID_RE, "Invalid artwork id"),
  photos: z.array(stagedEntrySchema).default([]),
  documents: z.array(stagedEntrySchema).default([]),
});

export type ArtworkCreatePayload = z.infer<typeof artworkCreateSchema>;

/**
 * The POST body of the single-artwork Add flow: the form payload, plus the
 * client-minted artwork id and the staged entries the save promotes in the
 * same transaction.
 *
 * The input is `ArtworkPayload` — the schema's output — because that is what
 * the form hands to its submit handler (`transformValues: toArtworkPayload`),
 * and a caller holding raw form values runs them through the schema first:
 * one parse, in one place. The cast is safe: the schema guarantees
 * `title`, `artistName` and `isPublic` on a valid submit, and the three
 * added keys are exactly what `artworkCreateSchema.extend` requires on top
 * of the payload.
 */
export const toArtworkCreatePayload = (
  payload: ArtworkPayload,
  artworkId: string,
  photos: StagedEntry[],
  documents: StagedEntry[],
): ArtworkCreatePayload =>
  ({
    ...payload,
    artworkId,
    photos,
    documents,
  }) as ArtworkCreatePayload;

/**
 * The text fields a PATCH may set or clear — the same twelve the form owns.
 * `title` and `artistName` are required and can never be cleared.
 */
export const UPDATABLE_TEXT_FIELDS = [
  "serie",
  "dateOfCreation",
  "media",
  "dimensions",
  "editions",
  "acquisitionDate",
  "acquisitionPrice",
  "placeOfOrigin",
  "provenance",
  "notes",
  "condition",
  "currentValue",
] as const;

// In a JSON payload a field is either a value, `null` (clear), or absent
// (leave alone). A string must be non-blank: clearing is the job of `null`.
const updatableText = z.string().trim().min(1).nullable().optional();

/**
 * PATCH …/artworks/{aid}. `photos`/`documents`, when present, are the FULL
 * new sequence (array position is the order) / set — stored ids and staged
 * ids interleaved; when absent, the sequence is left untouched (the form's
 * `commit()` returning null for "unchanged" is what produces the omission).
 */
export const artworkUpdateSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  artistName: z.string().trim().min(1, "Artist name is required"),
  serie: updatableText,
  dateOfCreation: updatableText,
  media: updatableText,
  dimensions: updatableText,
  editions: updatableText,
  acquisitionDate: z.iso.date().nullable().optional(),
  acquisitionPrice: updatableText,
  placeOfOrigin: updatableText,
  provenance: updatableText,
  notes: updatableText,
  condition: updatableText,
  currentValue: updatableText,
  isPublic: z.boolean().optional(),
  photos: z.array(stagedEntrySchema).optional(),
  documents: z.array(stagedEntrySchema).optional(),
});

export type ArtworkUpdatePayload = z.infer<typeof artworkUpdateSchema>;
