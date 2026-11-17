// The settings tabs' two save decisions, as pure folds.
//
// Each tab's Save writes only its own half of the PATCH: General decides
// from the catalogue's own facts, Public view from the skin and its option
// bag. Loaded values and edited values go in; a payload — or an error, for
// the password's client-side checks — comes out. A tab is clean exactly when
// its decision answers an empty payload: the disabled Save and the wire body
// are then the same answer, not two definitions of "changed". No DOM and no
// fetch, in the shape the password control's pair already established.

import type {
  ArtworkFieldDeviations,
  ArtworkFieldStates,
  CatalogueKind,
  CatalogueUpdatePayload,
} from "@arcula/shared";
import { normaliseArtworkFields } from "@arcula/shared";
import type { SkinOptionValue } from "@/skins/types";
import { resolvePasswordWrite } from "./cataloguePassword";

/** Shallow equality over the option bag. Order does not matter, values do. */
export const skinOptionsChanged = (
  next: Record<string, SkinOptionValue>,
  loaded: Record<string, SkinOptionValue>,
): boolean => {
  const keys = new Set([...Object.keys(next), ...Object.keys(loaded)]);
  for (const key of keys) {
    if (next[key] !== loaded[key]) {
      return true;
    }
  }
  return false;
};

/** The General tab's half of the PATCH, over the values it loaded. */
export interface GeneralLoadedValues {
  name: string;
  description: string | null;
  isPublic: boolean;
  isPasswordProtected: boolean;
  /** The Kind the stored deviations are resolved against. */
  kind: CatalogueKind;
  /** The sparse map the catalogue holds; null/absent means pure defaults. */
  artworkFields: ArtworkFieldDeviations | null;
}

/** The General tab's half of the PATCH, as the form currently holds it. */
export interface GeneralEditedValues {
  name: string;
  description: string;
  isPublic: boolean;
  /** The confirmation is a client-side check only; it never goes on the wire. */
  password: string;
  confirm: string;
  /** A member asked to change the current password. */
  editingPassword: boolean;
  /** A member asked to remove it; applied by the next save. */
  removingPassword: boolean;
  /**
   * The Artwork fields switches as they stand — every field's state, never a
   * sparse map. The fold normalises it against the Kind, so the buffer may
   * hold a value equal to the default and still produce no write.
   */
  artworkFields: ArtworkFieldStates;
}

export type GeneralSaveDecision =
  | {
      kind: "payload";
      payload: CatalogueUpdatePayload;
      /** Whether the switches diverge from the Kind's defaults, as edited. */
      artworkFieldsCustomised: boolean;
    }
  | {
      kind: "error";
      message: string;
      /** Whether the switches diverge from the Kind's defaults, as edited. */
      artworkFieldsCustomised: boolean;
    };

/** Two sparse deviation maps name the same choices, order aside. */
const sameDeviations = (
  a: ArtworkFieldDeviations | null,
  b: ArtworkFieldDeviations | null,
): boolean => {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const key of keys) {
    if (
      a?.[key as keyof ArtworkFieldDeviations] !==
      b?.[key as keyof ArtworkFieldDeviations]
    ) {
      return false;
    }
  }
  return true;
};

/**
 * What the General tab's Save writes.
 *
 * The name goes out trimmed, only when it differs from what was loaded — a
 * rename never carries the rest of the tab. A description that was emptied is
 * an explicit clear, sent as `null`, never as an empty string: the wire has no
 * "clear" value other than `null`, and an absent key would leave the stored
 * text in place. The password half is the existing decision, composed rather
 * than restated: an untouched Protected catalogue sends no password key, and
 * a mismatch answers an error so the member can correct it and be told why.
 */
export const resolveGeneralSave = (
  loaded: GeneralLoadedValues,
  edited: GeneralEditedValues,
): GeneralSaveDecision => {
  const payload: CatalogueUpdatePayload = {};
  const name = edited.name.trim();
  if (name !== loaded.name) {
    payload.name = name;
  }
  if (edited.isPublic !== loaded.isPublic) {
    payload.isPublic = edited.isPublic;
  }
  const description = edited.description.trim();
  if (description !== (loaded.description?.trim() ?? "")) {
    payload.description = description === "" ? null : description;
  }

  // The switches resolve against the Kind the page loaded: normalising both
  // sides drops entries that only restate a default, so "changed" means a
  // different arrangement rather than a different object. An empty normalised
  // map is `{}` on the wire — the Reset a member asked for — and the API
  // stores it as null.
  const loadedFields = normaliseArtworkFields(
    loaded.kind,
    loaded.artworkFields,
  );
  const editedFields = normaliseArtworkFields(
    loaded.kind,
    edited.artworkFields,
  );
  if (!sameDeviations(loadedFields, editedFields)) {
    payload.artworkFields = editedFields ?? {};
  }
  const artworkFieldsCustomised = editedFields !== null;

  const passwordWrite = resolvePasswordWrite({
    isPublic: edited.isPublic,
    isPasswordProtected: loaded.isPasswordProtected,
    editing: edited.editingPassword,
    removing: edited.removingPassword,
    password: edited.password,
    confirm: edited.confirm,
  });
  if (passwordWrite.kind === "error") {
    return {
      kind: "error",
      message: passwordWrite.message,
      artworkFieldsCustomised,
    };
  }
  if (passwordWrite.kind === "set") {
    payload.password = passwordWrite.password;
  }
  if (passwordWrite.kind === "remove") {
    payload.password = null;
  }
  return { kind: "payload", payload, artworkFieldsCustomised };
};

/** The Public view tab's half of the PATCH, over the values it loaded. */
export interface PublicLoadedValues {
  skin: string;
  skinOptions: Record<string, SkinOptionValue>;
}

/** The Public view tab's half of the PATCH, as the form currently holds it. */
export interface PublicEditedValues {
  skin: string;
  skinOptions: Record<string, SkinOptionValue>;
}

/**
 * What the Public view tab's Save writes: the skin when it differs from the
 * loaded skin, and the option bag when any value in it differs. The bag is
 * compared by value, not identity. Stale options the loaded skin does not
 * declare are already dropped from the loaded bag this receives — which is
 * what the tab's notice reports — and it sends nothing else.
 */
export const resolvePublicSave = (
  loaded: PublicLoadedValues,
  edited: PublicEditedValues,
): CatalogueUpdatePayload => {
  const payload: CatalogueUpdatePayload = {};
  if (edited.skin !== loaded.skin) {
    payload.skin = edited.skin;
  }
  if (skinOptionsChanged(edited.skinOptions, loaded.skinOptions)) {
    payload.skinOptions = edited.skinOptions;
  }
  return payload;
};
