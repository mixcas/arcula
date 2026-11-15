// Artist Name suggestions, tier 1: the pure collapse/order/truncate decision
// over aggregate rows.
//
// The aggregate itself is the database's (grouped by exact spelling) and its
// wiring is pinned by artistNames.api.test.ts. What is here is the rule that
// turns those exact spellings into one option per artist — the only place it
// can be asserted without a wire or a database.

import { describe, expect, it } from "vitest";
import {
  MAX_ARTIST_NAME_SUGGESTIONS,
  collapseArtistNames,
  type ArtistNameAggregateRow,
} from "../src/artistNames";

const at = (day: number) => new Date(Date.UTC(2026, 0, day));

/** One aggregate row: an exact spelling, its work count and its newest use. */
const row = (name: string, count: number, day = 1): ArtistNameAggregateRow => ({
  name,
  count,
  lastUpdatedAt: at(day),
});

describe("the collapse", () => {
  it("drops blank and whitespace-only spellings", () => {
    expect(
      collapseArtistNames([row("", 5), row("   ", 4), row("\t\n", 3)]),
    ).toEqual([]);
  });

  it("collapses case and accent variants under the most-used spelling", () => {
    expect(
      collapseArtistNames([
        row("Pablo Picasso", 2),
        row("pablo picasso", 1),
        row("PÁBLO PICASSO", 1),
        // Surrounding whitespace is not part of the artist: trimmed, this is
        // the same key as the spellings above and loses to their count.
        row("  Pablo Picasso  ", 0),
        row("María López", 3),
        row("Maria Lopez", 1),
      ]),
    ).toEqual(["María López", "Pablo Picasso"]);
  });

  it("breaks a count tie on the most recently updated work", () => {
    expect(
      collapseArtistNames([
        row("Pablo Picasso", 2, 10),
        row("pablo picasso", 2, 20),
      ]),
    ).toEqual(["pablo picasso"]);
  });

  it("breaks a full tie lexicographically, so the answer is deterministic", () => {
    expect(
      collapseArtistNames([row("picasso", 1, 10), row("Picasso", 1, 10)]),
    ).toEqual(["Picasso"]);
  });
});

describe("the order", () => {
  it("puts the most-used first, then display names case-insensitively", () => {
    expect(
      collapseArtistNames([
        row("Zebra", 2),
        row("apple", 1),
        row("Claude Monet", 1),
        row("draft artist", 1),
      ]),
    ).toEqual(["Zebra", "apple", "Claude Monet", "draft artist"]);
  });
});

describe("the cap", () => {
  it("truncates silently at 2,000 names after ordering", () => {
    // The 2,001st row is the most-used, so a correct list keeps it at the
    // front and drops the last name in the alphabetical tail. Slicing before
    // ordering would drop the most-used name and keep the tail instead.
    const rows = Array.from(
      { length: MAX_ARTIST_NAME_SUGGESTIONS + 1 },
      (_, i) =>
        row(
          `artist-${String(i).padStart(4, "0")}`,
          i === MAX_ARTIST_NAME_SUGGESTIONS ? 2 : 1,
        ),
    );

    const names = collapseArtistNames(rows);
    expect(names).toHaveLength(MAX_ARTIST_NAME_SUGGESTIONS);
    expect(names[0]).toBe("artist-2000");
    expect(names.at(-1)).toBe("artist-1998");
    expect(names).not.toContain("artist-1999");
  });
});
