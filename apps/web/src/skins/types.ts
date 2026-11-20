/**
 * The contract between the public-view shell and a skin.
 *
 * A skin owns the *presentation* of a catalogue's public views — layout, type,
 * colours, interaction — and nothing else. It never imports a service, never
 * touches `db`, and never decides whether the visitor is allowed to see
 * anything: the shell has already loaded the data, already mapped
 * `permission-denied` to the private state, and hands the skin a dataset that
 * is safe to render. That boundary is what makes a skin testable with plain
 * objects.
 *
 * A skin is deliberately a **component tree rather than a layout config**. The
 * alternative — one generic engine driven by JSON — would have to express
 * overlays, cursor zones and nested scroll behaviour in a vocabulary, and that
 * vocabulary would end up being most of the code while still being less
 * expressive than React. What *is* data-driven is the narrow part that actually
 * varies per catalogue: a handful of options, declared by the skin itself.
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
import type { Artwork, Catalogue } from "@arcula/shared";

/** Which public view the shell is rendering. */
export type SkinView = "home" | "artwork" | "selection";

/** A value a skin option may hold. Mirrors `Catalogue.skinOptions`. */
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
  /** Stable key. It is what gets persisted in `Catalogue.skinOptions`. */
  key: string;
  /** Shown in the generated Manage settings form. */
  label: string;
  description?: string;
}

interface BooleanOptionSpec extends SkinOptionSpecBase {
  kind: "boolean";
  default: boolean;
}

interface NumberOptionSpec extends SkinOptionSpecBase {
  kind: "number";
  default: number;
  /** Bounds for the generated control. A stored value outside them is clamped. */
  min?: number;
  max?: number;
  step?: number;
}

interface TextOptionSpec extends SkinOptionSpecBase {
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

/**
 * What the skin is presenting, independent of where it came from.
 *
 * A Catalogue's public views and a Selection's share one presenter, so the
 * skin reads this rather than a `Catalogue` document: `name` and `description`
 * are the document's own, and on a Selection `catalogueName` is the credit
 * line naming the Catalogue it was cut from. A skin that read
 * `catalogue.description` instead would render the source Catalogue's words on
 * a Selection, and would have no credit line at all.
 */
export interface SkinSubject {
  /** The document's name: the Catalogue's or the Selection's. */
  name: string;
  /** Its own description. Absent or blank means nothing to introduce. */
  description?: string;
  /**
   * The source Catalogue's name, on a `selection` view only.
   *
   * A credit, never a link: the Catalogue may be private, so a skin is given
   * no path to it and must not build one.
   */
  catalogueName?: string;
}

/** Props every view shares, whichever document it is presenting. */
interface SkinViewProps {
  /** What is being presented. Read `subject`, never `catalogue`. */
  subject: SkinSubject;
  /**
   * On `home` and `selection` this is every work in the document, in the order
   * the shell decided (the Catalogue's public list, or the Selection's
   * position order). On `artwork` it is the single work being viewed — still an
   * array, because the views differ only in how many sections there are, and a
   * skin that renders one component for all of them needs one shape.
   */
  artworks: Artwork[];
  /** Already resolved against this skin's specs: every declared key present. */
  options: SkinOptions;
  /** The canonical public path of one artwork, wherever the document lives. */
  artworkPath: (artwork: Artwork) => string;
}

/**
 * Everything the shell knows and a skin is allowed to ask about.
 *
 * A union on `view`, not a flat interface with optional fields: the selection
 * variant has a `selectionPath` and deliberately **no** `cataloguePath`, so a
 * skin cannot link a source Catalogue that may be private (or gone). Making
 * the path absent rather than empty is what turns that rule into a type.
 */
export type SkinProps =
  | (SkinViewProps & {
      view: "home";
      catalogue: Catalogue;
      cataloguePath: string;
    })
  | (SkinViewProps & {
      view: "artwork";
      catalogue: Catalogue;
      cataloguePath: string;
    })
  | (SkinViewProps & {
      view: "selection";
      /** The canonical public path of the Selection, for its own links. */
      selectionPath: string;
    });

export interface SkinDefinition {
  /** Persisted on `Catalogue.skin`. Never renamed once shipped. */
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
  /** The catalogue homepage — normally one section per artwork. */
  Home: ComponentType<Extract<SkinProps, { view: "home" }>>;
  /** The single-artwork view. May show more than `Home` does. */
  Artwork: ComponentType<Extract<SkinProps, { view: "artwork" }>>;
  /**
   * A Selection's public page: the same works-in-order layout as `Home`, with
   * the Selection's subject and its Catalogue credited by name.
   */
  Selection: ComponentType<Extract<SkinProps, { view: "selection" }>>;
}
