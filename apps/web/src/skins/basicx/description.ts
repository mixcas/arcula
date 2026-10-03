/**
 * When the collection description is dismissed on Basicx's home view.
 *
 * The description sits bottom-right in the fixed footer while the visitor is
 * on the very first photo of the *first* artwork. Two things dismiss it, and
 * once dismissed it never comes back for the visit:
 *
 * - Scrolling to the second artwork onwards — the description is an
 *   introduction to the collection, and the visitor past the first work has
 *   moved on from the introduction.
 * - On the first artwork, clicking to the second photo — the first photo is
 *   the moment the description accompanies, and the next photo is the visitor
 *   stepping past it.
 *
 * "Never comes back" is not a latch inside the skin — the react-hooks rules
 * rightly object to state written during render, which is the only way a
 * latch could be hidden in the component. Instead `BasicxSkin` hands this
 * predicate inputs that are themselves monotonic, so the one-way rule is a
 * plain derived value: `artworkIndex` is the *farthest* artwork the visitor
 * has reached (`useActiveSection.farthestIndex`, which only grows), and
 * `photoIndex` is the *highest* photo index reached in the artwork in view
 * (the skin's photo record keeps the max). Once either crosses its threshold
 * it stays crossed, so "once hidden" holds by construction.
 *
 * A single-photo work needs no exemption clause here, and that is not an
 * oversight: it renders no carousel (`BasicxSection` shows the image on its
 * own), so it never reports a photo index at all and the photo clause cannot
 * fire — the first photo has no next photo to step to. Family table:
 *
 *   | artwork | photo | description |
 *   | ------- | ----- | ----------- |
 *   | 0       | 0     | visible     |
 *   | 0       | 1+    | hidden      |
 *   | 1+      | any   | hidden      |
 *
 * Kept pure and separate from the skin so the table above is a plain unit
 * test and not something that needs jsdom — the embla-driven photo index and
 * the scroll-driven artwork index are both arguments to it.
 */

export interface DescriptionContext {
  /** The farthest artwork the visitor has reached. `0` is the first section on `home`. */
  artworkIndex: number;
  /** The highest photo index reached in the artwork in view. `0` until the carousel reports. */
  photoIndex: number;
}

export const descriptionDismissed = ({
  artworkIndex,
  photoIndex,
}: DescriptionContext): boolean => artworkIndex >= 1 || photoIndex >= 1;
