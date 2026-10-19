import { describe, expect, it } from "vitest";

import { descriptionDismissed } from "@/skins/basicx/description";

/**
 * The dismissal table, as data rather than prose: each row is
 * (artworkIndex, photoIndex) and whether the description should be gone. From
 * the file header:
 *
 *   artwork 0, photo 0:  visible
 *   artwork 0, photo 1+: hidden
 *   artwork 1+, any:     hidden
 *
 * There is no photoCount in the table: the photo clause is "past the first
 * photo", and a single-photo work never reports an index at all, so nothing
 * here needs to know how many photos a work has.
 */
const CASES: Array<[number, number, boolean]> = [
  // First artwork, first photo: the one moment the description accompanies.
  [0, 0, false],
  // Any later photo of the first artwork: the visitor has stepped past the
  // introduction.
  [0, 1, true],
  [0, 2, true],
  [0, 3, true],
  [0, 7, true],
  // The second artwork onwards hides whatever the first photo does. A
  // single-photo work stays on photo 0, so [1, 0] is the anchored scroll
  // case.
  [1, 0, true],
  [1, 1, true],
  [3, 2, true],
];

describe("descriptionDismissed", () => {
  it("matches the family table", () => {
    for (const [artworkIndex, photoIndex, dismissed] of CASES) {
      expect(
        descriptionDismissed({ artworkIndex, photoIndex }),
        `artwork ${artworkIndex}, photo ${photoIndex}`,
      ).toBe(dismissed);
    }
  });

  it("leaves the description alone when it would never exist on the artwork view", () => {
    // The artwork view hands the skin a one-element array, but the view gate
    // (view === "home") lives in BasicxSkin — the rule itself still has to be
    // well-behaved for the single listed artwork.
    expect(descriptionDismissed({ artworkIndex: 0, photoIndex: 0 })).toBe(
      false,
    );
  });
});
