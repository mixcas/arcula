import { deleteField } from "firebase/firestore";
import { z } from "zod";
import type { Artwork, ArtworkUpdate } from "@/types";

/**
 * Validation and Firestore shaping for the artwork form, shared by
 * ArtworkAddPage and ArtworkEditPage so both write identical documents for
 * identical input.
 *
 * One schema does three jobs that used to be spread across both pages as
 * hand-rolled code: it validates, it coerces (via the transforms below), and
 * its output *is* the payload — `@mantine/form` feeds `z.output` to the submit
 * handler through `transformValues`, so there is no second conversion step.
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
}

/** The trimmed, validated, Firestore-ready subset of an artwork. */
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
};

/** The fields this form owns; the only ones that may be cleared on save. */
const EDITABLE_FIELDS = [
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
] as const satisfies ReadonlyArray<keyof ArtworkFormValues>;

/**
 * Remove the keys the schema resolved to `undefined`.
 *
 * Firestore rejects an explicit `undefined` property value — `updateDoc` and
 * `addDoc` both throw `invalid-argument` — so "unset" has to mean "the key is
 * not there", not "the key is there and holds undefined".
 */
const stripUndefined = (payload: Record<string, unknown>): ArtworkPayload =>
  Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );

/**
 * Validate form values and shape them into a Firestore payload.
 * Wired to `useForm` as `transformValues`, so it only runs on a valid submit.
 */
export const toArtworkPayload = (values: ArtworkFormValues): ArtworkPayload =>
  stripUndefined(artworkSchema.parse(values));

/** Build the payload for a new document, where every required field is set. */
export const toNewArtwork = (
  payload: ArtworkPayload,
  collectionId: string,
  userId: string,
): Omit<Artwork, "id"> => ({
  ...payload,
  // Re-narrow: the payload types these as optional, but the schema guarantees
  // them. Listing them after the spread also stops form data from ever
  // overriding the ownership fields below.
  title: payload.title ?? "",
  artistName: payload.artistName ?? "",
  // The bare Firestore document id, never the "{slug}-{id}" route param from
  // FULLSPEC §10. A slug is cosmetic and changes when the collection is
  // renamed, so storing one would orphan the artwork on the next rename.
  collectionId,
  userId,
  // TODO: upload to Firebase Storage per FULLSPEC §8 and store the resulting
  // FileReferences once a storage service exists.
  certificates: [],
  photos: [],
});

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
});

/**
 * Shape an edit into an `updateDoc` payload.
 *
 * `updateDoc` merges, so a field the user cleared is simply missing from the
 * payload and the stored value would survive — the form could never empty a
 * field. Any field that had a value on load but is now blank is therefore sent
 * as a `deleteField()` sentinel to remove it for real.
 */
export const toArtworkUpdate = (
  original: ArtworkFormValues,
  payload: ArtworkPayload,
): ArtworkUpdate => {
  const cleared = EDITABLE_FIELDS.filter((key) => {
    const loaded = original[key];
    // `null` counts as unset. A cleared `clearable` DateInput leaves the value
    // null, and there is no stored value to remove in that case — treating it
    // as "was set" would attach a deleteField() to a field that never had one.
    const wasSet = loaded !== undefined && loaded !== null && loaded !== "";
    return wasSet && !(key in payload);
  });

  return {
    ...payload,
    ...Object.fromEntries(cleared.map((key) => [key, deleteField()])),
  };
};
