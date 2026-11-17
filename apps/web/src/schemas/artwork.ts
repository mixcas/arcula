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
import { ARTWORK_FIELD_KEYS, UPDATABLE_TEXT_FIELDS } from "@arcula/shared";
import type {
  ArtworkFieldStates,
  ArtworkFormValues,
  ArtworkPayload,
  ArtworkUpdatePayload,
} from "@arcula/shared";

/**
 * The 12 text fields a PATCH may set or clear — `null` clears, an absent key
 * leaves the stored value, a string sets. `status` has no third state: the
 * form always has one selected, and the patch carries it as it stands.
 *
 * `availability` is decided by the Catalogue's Artwork fields rather than by
 * its Kind: when the field is enabled the form's value is carried, with `null`
 * as a real value on the wire; when it is disabled the key is omitted entirely,
 * which keeps a stored state untouched.
 *
 * The three-way decision per field is against the loaded values, not against
 * the schema: the schema says whether the *current* input is blank, and only
 * the loaded value says whether clearing it is a change at all.
 */
export const toArtworkUpdate = (
  loaded: ArtworkFormValues,
  payload: ArtworkPayload,
  enabled: ArtworkFieldStates,
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
    // A field the catalogue does not record is not in the payload at all:
    // its stored value stays untouched, and the form's loaded buffer — which
    // still holds it — never turns into a `null` clear.
    if (!enabled[field]) {
      continue;
    }
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
  if (enabled.availability) {
    // The control always holds one of the four when it is on screen; `null` is
    // the wire's "no market state", not "leave it alone".
    update.availability = payload.availability ?? null;
  }
  return update;
};

/**
 * Drop every field the catalogue does not record from a create payload.
 *
 * The form validates and submits every field's value whether or not its input
 * is on screen, so a hidden field that still holds a value would otherwise be
 * written again on the next save. A disabled key — Availability included — is
 * left out entirely, never sent as `null`, which keeps the stored value and
 * makes the server's later refusal of a disabled field unreachable from this
 * form.
 */
export const withoutDisabledArtworkFields = (
  payload: ArtworkPayload,
  enabled: ArtworkFieldStates,
): ArtworkPayload => {
  const copy = { ...payload };
  for (const field of ARTWORK_FIELD_KEYS) {
    if (!enabled[field]) {
      delete copy[field];
    }
  }
  return copy;
};
