/**
 * The PATCH-payload seam of the artwork schema — the only part of it that
 * stays in the web app.
 *
 * Everything else (validation, coercion, `ArtworkFormValues`, the create
 * payload, the import pipeline) lives in `@arcula/shared/src/schemas/`: it is
 * pure, and the API validates and writes with the same code. This
 * file exists because a PATCH needs a third state the schema alone cannot
 * express: a field the user cleared. In the JSON the API accepts, a cleared
 * field is `null` and an absent one is "leave it alone" — so the payload has
 * to be built against the loaded values, and that comparison belongs next to
 * the form that owns both.
 */
import { UPDATABLE_TEXT_FIELDS } from "@arcula/shared";
import type {
  ArtworkFormValues,
  ArtworkPayload,
  ArtworkUpdatePayload,
} from "@arcula/shared";

/**
 * The 12 text fields a PATCH may set or clear — `null` clears, an absent key
 * leaves the stored value, a string sets. `status` has no third state: the
 * form always has one selected, and the patch carries it as it stands.
 *
 * `availability` is the same for the kinds that surface it, with one addition:
 * the form's `null` is a real value (a work with no market state), so it is
 * carried as the wire's own `null` rather than omitted. A kind that does not
 * surface it omits the key entirely, which is what keeps a Collection's stored
 * value untouched.
 *
 * The three-way decision per field is against the loaded values, not against
 * the schema: the schema says whether the *current* input is blank, and only
 * the loaded value says whether clearing it is a change at all.
 */
export const toArtworkUpdate = (
  loaded: ArtworkFormValues,
  payload: ArtworkPayload,
  availabilityInPlay = false,
): ArtworkUpdatePayload => {
  const update: ArtworkUpdatePayload = {
    // Required on the wire: the schema guarantees both are non-blank on a
    // valid submit, and the `?? ""` only exists to keep that guarantee inside
    // the cast.
    title: payload.title ?? "",
    artistName: payload.artistName ?? "",
    // Always sent, for the same reason as `title`: the form owns the control,
    // and the PATCH wants the chosen value rather than a change detection on
    // it. `loaded` says nothing about it, because there is no third state to
    // decide against — a status is chosen, never cleared.
    status: payload.status ?? "published",
  };
  for (const field of UPDATABLE_TEXT_FIELDS) {
    const next = payload[field];
    if (typeof next === "string") {
      update[field] = next;
    } else if (typeof loaded[field] === "string" && loaded[field] !== "") {
      // Undefined, and the loaded value was not blank: the user cleared it,
      // and `null` is the wire word for "remove".
      update[field] = null;
    }
    // Blank on both sides: omit. The stored value is already empty, and
    // sending `null` for it would be a write with no effect.
  }
  if (availabilityInPlay) {
    // The control always holds one of the four when it is on screen; `null` is
    // the wire's "no market state", not "leave it alone".
    update.availability = payload.availability ?? null;
  }
  return update;
};

/**
 * Drop `availability` from a payload for a kind that does not carry it.
 *
 * A Collection's form has no control, and the field is optional on every save
 * schema, so the honest payload is one without the key: the API's PATCH leaves
 * the column alone and its create writes null. Sending `null` would be a write
 * the user never made.
 */
export const withoutAvailability = (
  payload: ArtworkPayload,
): ArtworkPayload => {
  const copy = { ...payload };
  delete copy.availability;
  return copy;
};
