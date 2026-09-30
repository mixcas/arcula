/**
 * The skin registry: which skins exist, which one a collection uses, and what
 * its options resolve to.
 *
 * Adding a skin is a one-line change here plus its own folder. Nothing else in
 * the app enumerates skins, which is why the settings form can be generated
 * rather than hand-written per skin.
 */

import { basicxSkin } from "./basicx";
import type {
  SkinDefinition,
  SkinOptions,
  SkinOptionSpec,
  SkinOptionValue,
} from "./types";

/**
 * The skin a collection with no `skin` field — or an unrecognised one — gets.
 *
 * Exported as the *definition* and the id derived from it, so the constant the
 * app falls back to and the id written to Firestore cannot drift apart.
 */
export const DEFAULT_SKIN: SkinDefinition = basicxSkin;
export const DEFAULT_SKIN_ID: string = DEFAULT_SKIN.id;

/** Every skin, for the settings picker. */
export const SKINS: readonly SkinDefinition[] = [DEFAULT_SKIN];

/**
 * The skin for a collection.
 *
 * A missing or unknown id resolves to the default rather than rendering
 * nothing. A typo in a skin id, or a collection written before skins existed,
 * must not produce a blank page — and the caller already holds a document it
 * successfully fetched, so falling back is always possible.
 */
export const resolveSkin = (id: string | null | undefined): SkinDefinition =>
  SKINS.find((skin) => skin.id === id) ?? DEFAULT_SKIN;

export interface ResolvedSkinOptions {
  /** Every declared key, present and correctly typed. */
  options: SkinOptions;
  /**
   * Keys the collection stores that the selected skin no longer declares.
   *
   * Reported rather than silently discarded so Manage can say so out loud. A
   * skin that drops or renames an option is otherwise indistinguishable from a
   * settings form that never worked, and the owner is the only one who can fix
   * it.
   */
  dropped: string[];
}

/**
 * Read one stored value against a spec.
 *
 * `undefined` means "use the default" and covers both a wrong type and a
 * missing key. A *number* outside its declared bounds is clamped rather than
 * defaulted: the bounds are a UI convenience, and quietly replacing a stored
 * 8-second transition with the 0.5 default because someone typed 8 would lose
 * the owner's intent when a number input's max is not an enforcement.
 */
const readValue = (
  spec: SkinOptionSpec,
  value: unknown,
): SkinOptionValue | undefined => {
  switch (spec.kind) {
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "text":
      return typeof value === "string" ? value : undefined;
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
      }
      const min = spec.min ?? Number.NEGATIVE_INFINITY;
      const max = spec.max ?? Number.POSITIVE_INFINITY;
      return Math.min(Math.max(value, min), max);
    }
  }
};

/**
 * Resolve a collection's stored options against a skin's specs.
 *
 * A flat per-key default with no cross-option logic, deliberately: the one
 * option that used to depend on another (`autoplaySeconds`, meaningful only
 * when `autoplay` was on) is gone, and that is what keeps this honest. A skin
 * whose options interact should express the interaction in its own component,
 * not here.
 */
export const resolveSkinOptions = (
  skin: SkinDefinition,
  stored: Record<string, unknown> | null | undefined,
): ResolvedSkinOptions => {
  const declared = new Map(skin.options.map((spec) => [spec.key, spec]));
  const options: SkinOptions = {};
  const dropped: string[] = [];

  for (const spec of skin.options) {
    const value = stored ? readValue(spec, stored[spec.key]) : undefined;
    options[spec.key] = value === undefined ? spec.default : value;
  }

  for (const key of Object.keys(stored ?? {})) {
    if (!declared.has(key)) {
      dropped.push(key);
    }
  }

  return { options, dropped };
};
