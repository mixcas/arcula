/**
 * The contract between the public-view shell and a skin.
 *
 * A skin owns the *presentation* of a collection's public views — layout, type,
 * colours, interaction — and nothing else. It never imports a service, never
 * touches `db`, and never decides whether the visitor is allowed to see
 * anything: the shell has already loaded the data, already mapped
 * `permission-denied` to the private state, and hands the skin a dataset that
 * is safe to render. That boundary is what makes a skin testable with plain
 * objects and no emulator.
 *
 * A skin is deliberately a **component tree rather than a layout config**. The
 * alternative — one generic engine driven by JSON — would have to express
 * overlays, cursor zones and nested scroll behaviour in a vocabulary, and that
 * vocabulary would end up being most of the code while still being less
 * expressive than React. What *is* data-driven is the narrow part that actually
 * varies per collection: a handful of options, declared by the skin itself.
 *
 * ## Style isolation
 *
 * A skin's theme is applied by a nested `MantineProvider` carrying
 * `cssVariablesSelector=".skin-scope"`, which emits its CSS variables onto a
 * wrapper element instead of `:root`. Without that selector a nested provider
 * overwrites the *whole app's* `--mantine-*` variables — `cssVariablesSelector`
 * defaults to `:root` — so a skin's type scale would leak into `/manage`.
 *
 * The consequence is the one hard rule for skin authors: **a skin must not use
 * a Mantine component that portals.** `Modal`, `Drawer`, `Menu`, `Popover`,
 * `Select`, `Combobox`, `Tooltip` and the `Notifications` stack all render into
 * `document.body`, outside `.skin-scope`, so they would silently pick up the
 * app theme instead of the skin's. `Box`, `Stack`, `Group`, `Grid`, `Text`,
 * `Anchor`, `Image`, `ActionIcon` and `Carousel` are all fine — they render in
 * place.
 */

import type { ComponentType } from "react";
import type { MantineThemeOverride } from "@mantine/core";
import type { Artwork, Collection } from "@/types";

/** Which public view the shell is rendering. */
export type SkinView = "home" | "artwork";

/** A value a skin option may hold. Mirrors `Collection.skinOptions`. */
export type SkinOptionValue = boolean | number | string;

/**
 * The resolved option bag handed to a skin.
 *
 * Untyped on purpose: the vocabulary belongs to the skin, and a shared
 * `Record<string, ...>` is what lets each skin declare its own without growing
 * a global list. Every skin narrows it once, at its own boundary.
 */
export type SkinOptions = Record<string, SkinOptionValue>;

interface SkinOptionSpecBase {
  /** Stable key. It is what gets persisted in `Collection.skinOptions`. */
  key: string;
  /** Shown in the generated Manage settings form. */
  label: string;
  description?: string;
}

export interface BooleanOptionSpec extends SkinOptionSpecBase {
  kind: "boolean";
  default: boolean;
}

export interface NumberOptionSpec extends SkinOptionSpecBase {
  kind: "number";
  default: number;
  /** Bounds for the generated control. A stored value outside them is clamped. */
  min?: number;
  max?: number;
  step?: number;
}

export interface TextOptionSpec extends SkinOptionSpecBase {
  kind: "text";
  default: string;
}

/**
 * A discriminated union on `kind`, so a boolean spec cannot carry a string
 * default and a number's bounds cannot be declared on something that has none.
 * Same reasoning as `ArtworkDocument`: "what shape is this option" is decided
 * once, at the type, rather than re-checked at every call site.
 */
export type SkinOptionSpec =
  BooleanOptionSpec | NumberOptionSpec | TextOptionSpec;

/** Everything the shell knows and a skin is allowed to ask about. */
export interface SkinProps {
  collection: Collection;
  /**
   * On `home` this is every public, live artwork in the collection. On
   * `artwork` it is the single work being viewed — still an array, because the
   * two views differ only in how many sections there are, and a skin that
   * renders one component for both needs one shape.
   */
  artworks: Artwork[];
  view: SkinView;
  /** Already resolved against this skin's specs: every declared key present. */
  options: SkinOptions;
  /** The canonical public path of the collection, for links back to it. */
  collectionPath: string;
  /** The canonical public path of one artwork. */
  artworkPath: (artwork: Artwork) => string;
}

export interface SkinDefinition {
  /** Persisted on `Collection.skin`. Never renamed once shipped. */
  id: string;
  /** Shown in the Manage skin picker. */
  label: string;
  /**
   * This skin's option vocabulary, and nothing else's.
   *
   * Kept per skin rather than global on purpose: a shared list would have to be
   * honoured by every skin, so it could only ever grow to the *intersection* of
   * what skins can express — and an option a skin ignores is worse than one it
   * does not offer, because the settings form would advertise a control that
   * does nothing.
   */
  options: readonly SkinOptionSpec[];
  /**
   * Applied by a nested `MantineProvider` scoped to `.skin-scope`. Optional: a
   * skin may present entirely through Mantine style props.
   */
  theme?: MantineThemeOverride;
  /** The collection homepage — normally one section per artwork. */
  Home: ComponentType<SkinProps>;
  /** The single-artwork view. May show more than `Home` does. */
  Artwork: ComponentType<SkinProps>;
}
