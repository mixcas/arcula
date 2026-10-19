/**
 * Basicx's option vocabulary.
 *
 * One option. There is deliberately no autoplay and no "which fields to show":
 *
 * - Autoplay was cut because a collection homepage is a stack of fullscreen
 *   sections the visitor scrolls through at their own pace, and an autoplaying
 *   slideshow inside one of them fights that. Cutting it also removed the only
 *   option whose meaning depended on another one (`autoplaySeconds` matters only
 *   when `autoplay` is on), which is why `resolveSkinOptions` can stay a flat
 *   per-key default with no cross-option logic.
 * - Which fields appear is the *skin's* decision, not per-collection config.
 *   "Artist name, title, photos, or additional fields" varies by skin and by
 *   what the data happens to contain — an option per conceivable field would be
 *   a settings form nobody can reason about.
 *
 * `showPoweredBy` used to gate the footer's "Powered by Arcula" line. It is
 * gone: that text moved into the nav's right-hand slot, where what belongs is
 * decided by *who is looking* — the collection's owner gets a link to the manage
 * side, anyone else gets the attribution. That is a property of the viewer, not
 * a per-collection preference, so an option for it would be a control that does
 * nothing. The remaining slot's behaviour is a TODO in `BasicxChrome`.
 */

import type {
  SkinOptionSpec,
  SkinOptionValue,
  SkinOptions,
} from "@/skins/types";

/**
 * Declared `as const satisfies` rather than typed as the array directly, so a
 * spec whose `default` disagrees with its `kind` is a compile error and the
 * literal types survive for the narrowing below.
 */
export const BASICX_OPTION_SPECS = [
  {
    key: "transitionSeconds",
    label: "Slideshow transition (seconds)",
    description: "How long a photo takes to change. 0 is instant.",
    kind: "number",
    default: 0.5,
    min: 0,
    max: 3,
    step: 0.1,
  },
] as const satisfies readonly SkinOptionSpec[];

/** The narrowed shape Basicx's components actually read. */
export interface BasicxOptions {
  transitionSeconds: number;
}

const DEFAULTS: Record<string, SkinOptionValue> = Object.fromEntries(
  BASICX_OPTION_SPECS.map((spec) => [spec.key, spec.default]),
);

const read = <T extends SkinOptionValue>(
  options: SkinOptions,
  key: keyof BasicxOptions,
): T => {
  const value = options[key];
  return (value === undefined ? DEFAULTS[key] : value) as T;
};

/**
 * Narrow the resolved bag to Basicx's shape.
 *
 * The shell has already run this through `resolveSkinOptions`, so every declared
 * key is present and correctly typed and the cast is total. The defaults are
 * re-applied here anyway — not because they are expected to be missing, but
 * because a skin rendered directly in a test without going through the registry
 * would otherwise read `undefined` as `false`, and a wrong default that only
 * shows up in tests is the kind of thing that costs an afternoon.
 *
 * One narrowing at the skin's boundary rather than a cast at each of the six
 * places these two values are read.
 */
export const basicxOptions = (options: SkinOptions): BasicxOptions => ({
  transitionSeconds: read<number>(options, "transitionSeconds"),
});
