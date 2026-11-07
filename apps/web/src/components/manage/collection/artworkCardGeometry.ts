// The Grid's geometry, as arithmetic.
//
// The masonry is a CSS grid with one small auto-row unit and a per-card
// `grid-row-end: span N`, and the card's photo box is reserved at the photo's
// aspect clamped to a band. Both are plain numbers derived from measurements, so
// they live here where they can be tested without a browser: a span that is one
// row short overlaps the card below it, and a clamped aspect that is off crops
// the wrong edge.

/** The widest reserved box: a 2:1 panorama. */
export const ASPECT_MIN = 0.5;

/** The tallest reserved box: a 1.4 portrait. */
export const ASPECT_MAX = 1.4;

/** A photo with no usable dimensions reserves a square box. */
const ASPECT_FALLBACK = 1;

/**
 * The reserved photo box's height-to-width ratio, clamped to the band.
 *
 * Clamping, not letterboxing: the image is `object-fit: cover`, so a clamped
 * box crops the overflow — the card keeps a readable size for both an extreme
 * panorama and an extreme portrait without a per-card magic number. The band is
 * the only crop the Grid performs.
 *
 * A photo without two usable dimensions reserves a square, which is the neutral
 * bet: guessing a portrait from a lone height would shift every card below it
 * once the image landed.
 */
export const artworkCardAspect = (width: number, height: number): number => {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return ASPECT_FALLBACK;
  }
  return Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, height / width));
};

/**
 * How many masonry rows a card of `height` px occupies, given one row unit of
 * `rowUnit` px.
 *
 * The grid lays its rows out with a 1 px gap, so a row is `rowUnit + 1` tall and
 * a card needs its height rounded up to the next whole row. A card that has not
 * been measured (jsdom, a hidden tab, the frame before the ResizeObserver
 * answers) spans one row rather than none: `span 0` would remove it.
 */
export const artworkCardSpan = (height: number, rowUnit: number): number => {
  if (!Number.isFinite(height) || height <= 0) return 1;
  if (!Number.isFinite(rowUnit) || rowUnit <= 0) return 1;
  return Math.max(1, Math.ceil(height / (rowUnit + 1)));
};
