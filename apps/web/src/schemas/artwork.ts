/**
 * The Firestore `updateDoc` seam of the artwork schema — the only part of it
 * that stays in the web app.
 *
 * Everything else (validation, coercion, `ArtworkFormValues`, payload shaping,
 * the import pipeline) lives in `@arcula/shared/src/schemas/`: it is pure,
 * and the API validates and writes with the same code (plan §7). This file
 * exists because `updateDoc` merges: a field the user cleared is missing from
 * the payload and the stored value would survive, so cleared fields are sent
 * as `deleteField()` sentinels. That merge semantics is a property of the
 * Firebase service layer, and this file dies with it in Phase 4.
 */
import { deleteField } from "firebase/firestore";
import type { ArtworkFormValues, ArtworkPayload } from "@arcula/shared";
import type { ArtworkUpdate } from "@/types/updates";

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
