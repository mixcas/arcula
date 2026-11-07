// The Grid's two pieces of arithmetic, as pure functions: the aspect a card
// reserves its photo box at, and the number of masonry rows its measured height
// spans. No DOM — what a screenshot cannot pin: that a panorama and a tall
// portrait are clamped rather than letterboxed, that a square stays square, and
// that a zero-size measurement (jsdom, a hidden tab, a card that has not been
// laid out yet) answers a card that still occupies one row instead of none.

import { describe, expect, it } from "vitest";
import {
  ASPECT_MAX,
  ASPECT_MIN,
  artworkCardSpan,
  artworkCardAspect,
} from "@/components/manage/collection/artworkCardGeometry";

describe("artworkCardAspect", () => {
  it("keeps a natural aspect inside the clamp", () => {
    // A landscape 3:2 and a mild portrait 3:4 are both ordinary prints.
    expect(artworkCardAspect(300, 200)).toBeCloseTo(2 / 3);
    expect(artworkCardAspect(300, 400)).toBeCloseTo(4 / 3);
  });

  it("keeps a square square", () => {
    expect(artworkCardAspect(500, 500)).toBe(1);
  });

  it("flattens a panorama to the widest reserved box", () => {
    // A 4:1 panorama would reserve a 2 px-tall strip; the card clamps it to the
    // 2:1 floor and crops the sides with object-fit: cover.
    expect(artworkCardAspect(4000, 1000)).toBe(ASPECT_MIN);
    expect(ASPECT_MIN).toBe(0.5);
  });

  it("crops a tall portrait to the tallest reserved box", () => {
    expect(artworkCardAspect(400, 2000)).toBe(ASPECT_MAX);
    expect(ASPECT_MAX).toBe(1.4);
  });

  it("answers the square fallback for a size it cannot use", () => {
    // The variant's dimensions are the first paint's only hint; a legacy photo
    // without them must still reserve a box rather than collapse it.
    expect(artworkCardAspect(0, 0)).toBe(1);
    expect(artworkCardAspect(800, 0)).toBe(1);
    expect(artworkCardAspect(Number.NaN, 600)).toBe(1);
    expect(artworkCardAspect(-10, 600)).toBe(1);
  });
});

describe("artworkCardSpan", () => {
  it("spans the rows its height covers, rounded up", () => {
    // 300 px of card over an 8 px unit (so 9 px per row with the 1 px gap):
    // 34 rows covers 306 px, 33 only 297.
    expect(artworkCardSpan(300, 8)).toBe(34);
    // Exactly on a boundary is that many rows, not one more.
    expect(artworkCardSpan(306, 8)).toBe(34);
    expect(artworkCardSpan(307, 8)).toBe(35);
  });

  it("answers one row for a card that has not been measured", () => {
    // jsdom reports zero for everything, and a hidden tab measures zero too: a
    // span of 0 would make `grid-row-end: span 0` and the card would vanish.
    expect(artworkCardSpan(0, 8)).toBe(1);
    expect(artworkCardSpan(-5, 8)).toBe(1);
    expect(artworkCardSpan(Number.NaN, 8)).toBe(1);
    // A fraction of a row is still a row: a card cannot span "half of one".
    expect(artworkCardSpan(0.5, 8)).toBe(1);
  });

  it("answers one row when the row unit itself is unusable", () => {
    // The unit is read from CSS; before it resolves it can be 0 or NaN, and
    // dividing by it would be an infinite span.
    expect(artworkCardSpan(300, 0)).toBe(1);
    expect(artworkCardSpan(300, Number.NaN)).toBe(1);
  });
});
