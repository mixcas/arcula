// The Selection settings block's save decision, as a pure fold.
//
// The three visibility states are the product's, not the wire's: the API only
// knows `isPublic` and whether a password hash exists. "Protected" is the pair
// — public and passworded — and "Public" is public with no password. Keeping
// the translation here means the component has no branching of its own to get
// wrong, and the rules can be tested without a DOM.
//
// A save names only what changed. The name goes out trimmed, a description that
// was emptied is `null`, and the password is written only when the member asked
// for a new one or when leaving Protected for Public must clear the old one.
//
// The other decision here is the publish warning. Publishing a Selection whose
// Catalogue is not visitor-readable is the single moment this model's risk is
// taken, so the transition and the standing fact are one fold, computed from the
// member read and the works the page holds — never from the public read, which
// carries the Catalogue's name and nothing else.

import { passwordSchema } from "@arcula/shared";
import type {
  Artwork,
  Catalogue,
  Selection,
  SelectionUpdatePayload,
} from "@arcula/shared";

/** What the selector offers, and what the stored row means. */
export type SelectionVisibility = "private" | "public" | "protected";

/** The document the page last loaded or saved — the fold's "loaded" side. */
export interface SelectionSettingsLoaded {
  name: string;
  description: string | null;
  isPublic: boolean;
  isPasswordProtected: boolean;
}

/** The settings block as the member currently holds it. */
export interface SelectionSettingsEdited {
  name: string;
  description: string;
  visibility: SelectionVisibility;
  /** The new password, and its confirmation — client-side checks only. */
  password: string;
  confirm: string;
  /**
   * A member asked to change a password that is already set. It has no meaning
   * when the Selection is not already protected: the fields then show anyway,
   * because they are how it becomes protected.
   */
  editingPassword: boolean;
}

export type SelectionSaveDecision =
  | { kind: "payload"; payload: SelectionUpdatePayload }
  | { kind: "error"; message: string };

/** The visibility the stored row currently has. */
export const storedVisibility = (
  loaded: Pick<SelectionSettingsLoaded, "isPublic" | "isPasswordProtected">,
): SelectionVisibility =>
  !loaded.isPublic
    ? "private"
    : loaded.isPasswordProtected
      ? "protected"
      : "public";

/** Whether the password fields are the way this Selection becomes protected. */
export const needsPasswordFields = (
  loaded: Pick<SelectionSettingsLoaded, "isPasswordProtected">,
  edited: Pick<SelectionSettingsEdited, "visibility" | "editingPassword">,
): boolean =>
  edited.visibility === "protected" &&
  (!loaded.isPasswordProtected || edited.editingPassword);

/**
 * What the settings block's Save writes.
 *
 * Private sets `isPublic: false` and leaves the password alone: it is inert
 * behind a private gate, and keeping it means re-publishing does not silently
 * drop the protection. Public sets `isPublic: true` and, when a password was
 * set, clears it in the same write — that is what "clearing the password makes
 * it public-unprotected" means on the wire. Protected sets `isPublic: true` and
 * either leaves an existing password alone or validates and sets the new one.
 */
export const resolveSelectionSave = (
  loaded: SelectionSettingsLoaded,
  edited: SelectionSettingsEdited,
): SelectionSaveDecision => {
  const payload: SelectionUpdatePayload = {};
  const name = edited.name.trim();
  if (name === "") {
    return { kind: "error", message: "Selection name is required" };
  }
  if (name !== loaded.name) {
    payload.name = name;
  }
  const description = edited.description.trim();
  if (description !== (loaded.description?.trim() ?? "")) {
    payload.description = description === "" ? null : description;
  }

  if (edited.visibility === "private") {
    if (loaded.isPublic) {
      payload.isPublic = false;
    }
    return { kind: "payload", payload };
  }

  if (edited.visibility === "public") {
    if (!loaded.isPublic) {
      payload.isPublic = true;
    }
    // Leaving Protected for Public must end the protection, not leave a hash
    // that silently comes back on the next publish.
    if (loaded.isPasswordProtected) {
      payload.password = null;
    }
    return { kind: "payload", payload };
  }

  if (!loaded.isPublic) {
    payload.isPublic = true;
  }

  if (!needsPasswordFields(loaded, edited)) {
    return { kind: "payload", payload };
  }

  if (edited.password === "" && edited.confirm === "") {
    return {
      kind: "error",
      message: "Enter a password to protect this selection.",
    };
  }
  const parsed = passwordSchema.safeParse(edited.password);
  if (!parsed.success) {
    return {
      kind: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid password",
    };
  }
  if (edited.password !== edited.confirm) {
    return { kind: "error", message: "The passwords do not match" };
  }
  payload.password = parsed.data;
  return { kind: "payload", payload };
};

/** Which way a visitor is stopped at the source Catalogue. */
export type CatalogueGate = "private" | "protected";

/** The fact both the publish confirmation and the persistent note state. */
export interface PublishRisk {
  catalogueState: CatalogueGate;
  draftCount: number;
}

interface PublishRiskInput {
  /** The Selection as the server last answered it. */
  selection: Pick<Selection, "isPublic">;
  /** The PATCH about to be written. */
  update: Pick<SelectionUpdatePayload, "isPublic">;
  /** The source Catalogue, from the member read. */
  catalogue: Pick<Catalogue, "isPublic" | "isPasswordProtected">;
  /** The Selection's live works, in the order the page holds them. */
  works: ReadonlyArray<Pick<Artwork, "status">>;
}

/**
 * Why a visitor cannot read the Catalogue, or null when they can.
 *
 * A protected Catalogue is public and passworded: a visitor without the
 * password still sees nothing, so it is not visitor-readable either, and the
 * state is named "protected" rather than merged into "private".
 */
const catalogueGate = (
  catalogue: Pick<Catalogue, "isPublic" | "isPasswordProtected">,
): CatalogueGate | null =>
  catalogue.isPublic !== true
    ? "private"
    : catalogue.isPasswordProtected === true
      ? "protected"
      : null;

/**
 * The standing fact, while it holds: the Catalogue's state and how many of the
 * Selection's works are Drafts.
 *
 * The count is over the works the page has loaded, so it follows curation after
 * the refetch rather than drifting into a second source of truth. A Draft is
 * `status === "draft"`; an absent status is a published work.
 */
export const catalogueRisk = (
  catalogue: Pick<Catalogue, "isPublic" | "isPasswordProtected">,
  works: ReadonlyArray<Pick<Artwork, "status">>,
): PublishRisk | null => {
  const catalogueState = catalogueGate(catalogue);
  if (catalogueState === null) {
    return null;
  }
  return {
    catalogueState,
    draftCount: works.filter((work) => work.status === "draft").length,
  };
};

/**
 * Whether this PATCH is the moment the risk is taken: a Selection that is not
 * public becoming public while its Catalogue is not visitor-readable.
 *
 * Anything else — a rename, a password change, a publish from a Catalogue
 * visitors can read — has nothing to warn about, and the save proceeds.
 */
export const publishRisk = ({
  selection,
  update,
  catalogue,
  works,
}: PublishRiskInput): PublishRisk | null => {
  if (selection.isPublic) {
    return null;
  }
  if (update.isPublic !== true) {
    return null;
  }
  return catalogueRisk(catalogue, works);
};
