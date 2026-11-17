// Catalogue search, tier 1: the pure predicate over our own fields.
//
// Every matching permutation lives here, because this is the only place it can
// be asserted without a wire, a database or a DOM. The API suite proves the
// wiring; this suite proves the rule.

import { describe, expect, it } from "vitest";
import {
  artworkSearchSuffix,
  isBlankSearchQuery,
  matchesArtworkSearch,
  searchQueryOverflow,
  type ArtworkSearchField,
} from "../src/artworkSearch";
import {
  resolveArtworkFields,
  type ArtworkFieldKey,
  type ArtworkFieldStates,
} from "../src/artworkFields";

/**
 * A Catalogue's resolved fields, with the named ones turned off. The
 * Collection's defaults are all on, so a test names only what it switches.
 */
const fields = (off: readonly ArtworkFieldKey[] = []): ArtworkFieldStates => {
  const enabled = resolveArtworkFields("collection", null).enabled;
  for (const field of off) {
    enabled[field] = false;
  }
  return enabled;
};

/** Every togglable field off: a Catalogue that records only the fixed two. */
const nothingToggled = (): ArtworkFieldStates => {
  const enabled = fields();
  for (const field of Object.keys(enabled) as ArtworkFieldKey[]) {
    enabled[field] = false;
  }
  return enabled;
};

describe("matching", () => {
  it("ignores case", () => {
    expect(
      matchesArtworkSearch({ title: "Blue Period" }, "blue", fields()),
    ).toBe(true);
    expect(
      matchesArtworkSearch({ artistName: "Picasso" }, "PICASSO", fields()),
    ).toBe(true);
  });

  it("ignores accents by decomposing and stripping the marks", () => {
    expect(matchesArtworkSearch({ artistName: "Dalí" }, "dali", fields())).toBe(
      true,
    );
    expect(
      matchesArtworkSearch({ title: "Cézanne" }, "cezanne", fields()),
    ).toBe(true);
    expect(
      matchesArtworkSearch({ placeOfOrigin: "Málaga" }, "malaga", fields()),
    ).toBe(true);
  });

  it("treats punctuation as a separator, so a query reads the same either way", () => {
    const work = { artistName: "Dalí", dateOfCreation: "1889" };
    expect(matchesArtworkSearch(work, "Dalí, 1889", fields())).toBe(true);
    expect(matchesArtworkSearch(work, "Dali 1889", fields())).toBe(true);
    expect(matchesArtworkSearch(work, "(dali) — 1889", fields())).toBe(true);
  });

  it("requires every term, and lets terms match different fields", () => {
    const work = { title: "Blue Harbour", artistName: "Pablo Picasso" };
    expect(matchesArtworkSearch(work, "picasso blue", fields())).toBe(true);
    expect(matchesArtworkSearch(work, "PICASSO, Blue", fields())).toBe(true);

    // One term present is not enough: every term must be somewhere.
    expect(
      matchesArtworkSearch(
        { title: "Blue Harbour", artistName: "Claude Monet" },
        "picasso blue",
        fields(),
      ),
    ).toBe(false);
    expect(
      matchesArtworkSearch(
        { title: "Red Harbour", artistName: "Pablo Picasso" },
        "picasso blue",
        fields(),
      ),
    ).toBe(false);
  });

  it("matches each of the ten fields on its own", () => {
    const cases: {
      field: ArtworkSearchField;
      value: string;
      query: string;
    }[] = [
      { field: "title", value: "Harbour at Dusk", query: "harbour" },
      { field: "artistName", value: "Winslow Homer", query: "homer" },
      { field: "serie", value: "Coastal Studies", query: "coastal" },
      { field: "medium", value: "Oil on canvas", query: "canvas" },
      { field: "editions", value: "Edition 7 of 25", query: "edition" },
      { field: "dateOfCreation", value: "circa 1889", query: "circa" },
      { field: "acquisitionDate", value: "2023-03-05", query: "2023" },
      { field: "placeOfOrigin", value: "Málaga", query: "malaga" },
      {
        field: "provenance",
        value: "Gifted by the artist's estate",
        query: "estate",
      },
      { field: "notes", value: "Needs conservation", query: "conservation" },
    ];

    for (const { field, value, query } of cases) {
      expect(
        matchesArtworkSearch({ [field]: value }, query, fields()),
        `${field} should match "${query}"`,
      ).toBe(true);
    }
  });

  it("does not match a field outside the declared ten", () => {
    // A variable, not a fresh literal: the extra fields are exactly what a
    // stored row carries, and the predicate must ignore them.
    const sized = { title: "Untitled", dimensions: "120 x 80 cm" };
    expect(matchesArtworkSearch(sized, "120", fields())).toBe(false);

    const conditioned = { title: "Untitled", condition: "excellent" };
    expect(matchesArtworkSearch(conditioned, "excellent", fields())).toBe(
      false,
    );

    const priced = { title: "Untitled", acquisitionPrice: "1,200 EUR" };
    expect(matchesArtworkSearch(priced, "1200", fields())).toBe(false);
  });

  it("lets a field with no value contribute nothing", () => {
    expect(
      matchesArtworkSearch(
        { title: "Blue", notes: null, serie: undefined },
        "blue",
        fields(),
      ),
    ).toBe(true);
    expect(matchesArtworkSearch({}, "blue", fields())).toBe(false);
  });

  it("matches an acquisition date in its stored and English long forms", () => {
    const work = { title: "Nocturne", acquisitionDate: "2023-03-05" };
    // A year and a month name both find it, as do the ISO form and the long
    // form the form itself displays.
    expect(matchesArtworkSearch(work, "2023", fields())).toBe(true);
    expect(matchesArtworkSearch(work, "march", fields())).toBe(true);
    expect(matchesArtworkSearch(work, "March 5, 2023", fields())).toBe(true);
    expect(matchesArtworkSearch(work, "2023-03-05", fields())).toBe(true);
    expect(matchesArtworkSearch(work, "april", fields())).toBe(false);
    expect(matchesArtworkSearch(work, "2022", fields())).toBe(false);
  });
});

describe("the Catalogue's enabled fields", () => {
  it("matches each togglable field only while the Catalogue records it", () => {
    const cases: {
      field: ArtworkFieldKey;
      value: string;
      query: string;
    }[] = [
      { field: "serie", value: "Coastal Studies", query: "coastal" },
      { field: "medium", value: "Oil on canvas", query: "canvas" },
      { field: "editions", value: "Edition 7 of 25", query: "edition" },
      { field: "dateOfCreation", value: "circa 1889", query: "circa" },
      { field: "acquisitionDate", value: "2023-03-05", query: "2023" },
      { field: "placeOfOrigin", value: "Málaga", query: "malaga" },
      {
        field: "provenance",
        value: "Gifted by the artist's estate",
        query: "estate",
      },
      { field: "notes", value: "Needs conservation", query: "conservation" },
    ];

    for (const { field, value, query } of cases) {
      const work = { [field]: value };
      expect(
        matchesArtworkSearch(work, query, fields()),
        `${field} should match "${query}" while enabled`,
      ).toBe(true);
      expect(
        matchesArtworkSearch(work, query, fields([field])),
        `${field} should not match "${query}" while disabled`,
      ).toBe(false);
    }
  });

  it("always matches Title and Artist Name, whatever the settings say", () => {
    const none = nothingToggled();

    expect(
      matchesArtworkSearch({ title: "Harbour at Dusk" }, "harbour", none),
    ).toBe(true);
    expect(
      matchesArtworkSearch({ artistName: "Winslow Homer" }, "homer", none),
    ).toBe(true);
    // A disabled sibling does not take them with it.
    expect(
      matchesArtworkSearch(
        { title: "Harbour", artistName: "Homer", notes: "conservation" },
        "harbour homer",
        none,
      ),
    ).toBe(true);
    expect(
      matchesArtworkSearch(
        { title: "Harbour", notes: "conservation" },
        "conservation",
        none,
      ),
    ).toBe(false);
  });
});

describe("blank versus no terms", () => {
  it("calls an absent, empty or whitespace-only query blank: no search at all", () => {
    expect(isBlankSearchQuery(undefined)).toBe(true);
    expect(isBlankSearchQuery(null)).toBe(true);
    expect(isBlankSearchQuery("")).toBe(true);
    expect(isBlankSearchQuery("   \t\n")).toBe(true);
  });

  it("does not call punctuation-only a blank query: it is a committed search", () => {
    expect(isBlankSearchQuery("—")).toBe(false);
    expect(isBlankSearchQuery(" , . ! ")).toBe(false);
    expect(isBlankSearchQuery(" blue ")).toBe(false);
  });

  it("matches nothing when a committed query normalizes to zero terms", () => {
    expect(matchesArtworkSearch({ title: "Blue" }, "—", fields())).toBe(false);
    expect(matchesArtworkSearch({ title: "Blue" }, " , . ! ", fields())).toBe(
      false,
    );
  });
});

describe("the shared caps", () => {
  it("allows 200 characters and refuses 201", () => {
    expect(searchQueryOverflow("a".repeat(200))).toBeNull();
    expect(searchQueryOverflow("a".repeat(201))).toBe("too-long");
  });

  it("allows ten terms and refuses eleven", () => {
    const ten = "a b c d e f g h i j";
    expect(searchQueryOverflow(ten)).toBeNull();
    expect(searchQueryOverflow(`${ten} k`)).toBe("too-many-terms");
  });

  it("counts whitespace-separated words, so punctuation joins rather than divides", () => {
    // The cap is over words, not the predicate's punctuation-separated terms:
    // a hyphenated string is one word and must not be refused.
    expect(searchQueryOverflow("a-b-c-d-e-f-g-h-i-j-k")).toBeNull();
    expect(
      matchesArtworkSearch(
        { title: "a b c d e f g h i j k" },
        "a-b-c-d-e-f-g-h-i-j-k",
        fields(),
      ),
    ).toBe(true);

    // Eleven words still spend the cap.
    expect(
      searchQueryOverflow(
        "one two three four five six seven eight nine ten eleven",
      ),
    ).toBe("too-many-terms");
  });

  it("does not count a punctuation-only query as terms", () => {
    expect(searchQueryOverflow("— — —")).toBeNull();
  });
});

describe("the query suffix", () => {
  it("appends an encoded q only when there is something to search for", () => {
    expect(artworkSearchSuffix("")).toBe("");
    expect(artworkSearchSuffix("   ")).toBe("");
    expect(artworkSearchSuffix("picasso blue")).toBe("?q=picasso+blue");
    expect(artworkSearchSuffix("a&b=c")).toBe("?q=a%26b%3Dc");
  });
});
