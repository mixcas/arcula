// Catalogue search, tier 1: the pure predicate over our own fields, the
// structured query's parse, its filters, its order and its facets.
//
// Every matching permutation lives here, because this is the only place it can
// be asserted without a wire, a database or a DOM. The API suite proves the
// wiring; this suite proves the rule.

import { describe, expect, it } from "vitest";
import {
  ARTWORK_FILTER_FIELDS,
  ARTWORK_LIST_SORTS,
  MAX_ARTWORK_LIST_LIMIT,
  MAX_FACET_VALUES,
  MAX_SEARCH_FILTER_FIELDS,
  MAX_SEARCH_FILTER_VALUES,
  artworkFacets,
  artworkSearchSuffix,
  compareArtworksForList,
  isBlankSearchQuery,
  matchesArtworkFilters,
  matchesArtworkSearch,
  parseArtworkSearchQuery,
  searchQueryOverflow,
  type ArtworkFilterable,
  type ArtworkFilterField,
  type ArtworkSearchFilters,
  type ArtworkSearchField,
  type ArtworkSortable,
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

/** Every field on: the structured-filter tests are about the filter, not the settings. */
const filterFields = (): ArtworkFieldStates => {
  const enabled = fields();
  for (const field of Object.keys(enabled) as ArtworkFieldKey[]) {
    enabled[field] = true;
  }
  return enabled;
};

/** The structured-filter predicates, over every field enabled. */
const filterMatch = (
  work: ArtworkFilterable,
  filters: ArtworkSearchFilters,
): boolean => matchesArtworkFilters(work, filters, filterFields());

/** The facet counts, over every field enabled. */
const facetCount = (
  works: readonly ArtworkFilterable[],
  fields: readonly ArtworkFilterField[],
) => artworkFacets(works, fields, filterFields());

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

// ---------------------------------------------------------------------------
// The structured query
// ---------------------------------------------------------------------------

/** The parse, on a params record shaped as Hono's `queries()` returns it. */
const parse = (params: Record<string, string[]>) =>
  parseArtworkSearchQuery(params);

/** The one problem of an invalid parse, asserting it was invalid first. */
const problemOf = (params: Record<string, string[]>) => {
  const result = parse(params);
  expect(result.status).toBe("invalid");
  return result.status === "invalid" ? result.problem : null;
};

describe("the structured query's defaults", () => {
  it("sorts by updated, returns every match from the start, and asks for no facets", () => {
    expect(parse({})).toEqual({
      status: "ok",
      query: {
        filters: {},
        sort: "updated",
        limit: null,
        offset: 0,
        facets: [],
      },
    });
  });

  it("ignores q: free text is the route's own condition, not a filter", () => {
    const result = parse({ q: ["blue"] });
    expect(result.status === "ok" && result.query.filters).toEqual({});
  });
});

describe("the structured query's filters", () => {
  it("keeps every value of a repeated field, trimmed, and drops blanks", () => {
    const result = parse({
      artistName: [" Matisse ", "Picasso", "   "],
      medium: ["Oil"],
    });
    expect(result.status === "ok" && result.query.filters).toEqual({
      artistName: ["Matisse", "Picasso"],
      medium: ["Oil"],
    });
  });

  it("accepts the enumerated values exactly, and refuses one outside the list", () => {
    const ok = parse({ status: ["draft"], availability: ["on-consignment"] });
    expect(ok.status === "ok" && ok.query.filters).toEqual({
      status: ["draft"],
      availability: ["on-consignment"],
    });

    const problem = problemOf({ availability: ["avail"] });
    expect(problem?.field).toBe("availability");
    expect(problem?.message).toContain("avail");
  });

  it(`allows ${MAX_SEARCH_FILTER_VALUES} values per field and refuses one more`, () => {
    const atCap = Array.from(
      { length: MAX_SEARCH_FILTER_VALUES },
      (_, i) => `v${i}`,
    );
    expect(parse({ title: atCap }).status).toBe("ok");
    expect(problemOf({ title: [...atCap, "one-more"] })?.field).toBe("title");
  });

  it(`allows ${MAX_SEARCH_FILTER_FIELDS} filter fields and refuses one more`, () => {
    const atCap = Object.fromEntries(
      ARTWORK_FILTER_FIELDS.slice(0, MAX_SEARCH_FILTER_FIELDS).map((field) => [
        field,
        ["v"],
      ]),
    );
    expect(parse(atCap).status).toBe("ok");

    const overCap = Object.fromEntries(
      ARTWORK_FILTER_FIELDS.slice(0, MAX_SEARCH_FILTER_FIELDS + 1).map(
        (field) => [field, ["v"]],
      ),
    );
    const problem = problemOf(overCap);
    expect(problem?.message).toContain(String(MAX_SEARCH_FILTER_FIELDS));
  });

  it("refuses a field outside the filterable set, naming it", () => {
    const problem = problemOf({ colour: ["red"] });
    expect(problem?.field).toBe("colour");
    expect(problem?.message).toContain("colour");
  });
});

describe("the structured query's paging and order", () => {
  it("accepts every sort, defaults to updated, and refuses an unknown one", () => {
    for (const sort of ARTWORK_LIST_SORTS) {
      const result = parse({ sort: [sort] });
      expect(result.status === "ok" && result.query.sort).toBe(sort);
    }
    expect(problemOf({ sort: ["created"] })?.field).toBe("sort");
  });

  it(`accepts a limit up to ${MAX_ARTWORK_LIST_LIMIT}, with zero meaning an empty page`, () => {
    expect(parse({ limit: ["25"] })).toMatchObject({
      status: "ok",
      query: { limit: 25 },
    });
    expect(parse({ limit: [String(MAX_ARTWORK_LIST_LIMIT)] }).status).toBe(
      "ok",
    );
    expect(parse({ limit: ["0"] })).toMatchObject({
      status: "ok",
      query: { limit: 0 },
    });
  });

  it("refuses a limit past the cap, a negative one and a non-integer, naming limit", () => {
    for (const limit of [
      String(MAX_ARTWORK_LIST_LIMIT + 1),
      "-1",
      "1.5",
      "many",
      "",
    ]) {
      expect(problemOf({ limit: [limit] })?.field, `limit=${limit}`).toBe(
        "limit",
      );
    }
  });

  it("refuses an offset without a limit, naming the missing limit in the message", () => {
    const problem = problemOf({ offset: ["10"] });
    expect(problem?.field).toBe("offset");
    expect(problem?.message).toContain("limit");

    // Zero is still a present offset: the caller paged, and asked nothing of
    // it. The pair travels together.
    expect(problemOf({ offset: ["0"] })?.field).toBe("offset");
  });

  it("accepts an offset with a limit and refuses a malformed one", () => {
    expect(parse({ limit: ["10"], offset: ["20"] })).toMatchObject({
      status: "ok",
      query: { limit: 10, offset: 20 },
    });
    expect(problemOf({ limit: ["10"], offset: ["-1"] })?.field).toBe("offset");
    expect(problemOf({ limit: ["10"], offset: ["x"] })?.field).toBe("offset");
  });
});

describe("the structured query's facets", () => {
  it("names one or more filterable fields, each once", () => {
    const result = parse({ facets: ["title", "status", "title"] });
    expect(result.status === "ok" && result.query.facets).toEqual([
      "title",
      "status",
    ]);
  });

  it("refuses a facet field that is not filterable, naming it", () => {
    const problem = problemOf({ facets: ["dimensions"] });
    expect(problem?.field).toBe("facets");
    expect(problem?.message).toContain("dimensions");
  });
});

describe("the structured filters' matching", () => {
  const work = {
    title: "Blue Harbour",
    artistName: "Pablo Picasso",
    medium: "Oil on canvas",
    status: "published" as const,
    availability: "available" as const,
  };

  it("means either value within a field", () => {
    expect(filterMatch(work, { artistName: ["Matisse", "Picasso"] })).toBe(
      true,
    );
    expect(filterMatch(work, { artistName: ["Matisse", "Monet"] })).toBe(false);
  });

  it("means every populated field across fields", () => {
    expect(
      filterMatch(work, {
        artistName: ["Matisse", "Picasso"],
        medium: ["canvas"],
      }),
    ).toBe(true);
    // The artist matches, the serie does not: AND, not OR.
    expect(
      filterMatch(work, {
        artistName: ["Picasso"],
        serie: ["Coastal"],
      }),
    ).toBe(false);
  });

  it("normalizes both sides and matches within the named field only", () => {
    const accented = { title: "Cézanne Study", artistName: "Salvador Dalí" };
    expect(filterMatch(accented, { artistName: ["dali"] })).toBe(true);
    expect(filterMatch(accented, { artistName: ["DALÍ"] })).toBe(true);

    // The value appears in the work, but not in the field that was filtered.
    const noted = { title: "Red Field", notes: "Blue Harbour" };
    expect(filterMatch(noted, { title: ["harbour"] })).toBe(false);
  });

  it("matches an acquisition date in its stored and displayed forms", () => {
    const dated = { acquisitionDate: "2023-03-05" };
    expect(filterMatch(dated, { acquisitionDate: ["2023"] })).toBe(true);
    expect(filterMatch(dated, { acquisitionDate: ["March"] })).toBe(true);
  });

  it("compares an enumerated field exactly, never by prefix", () => {
    expect(filterMatch(work, { status: ["published"] })).toBe(true);
    expect(filterMatch(work, { status: ["pub"] })).toBe(false);
    expect(filterMatch(work, { status: ["draft"] })).toBe(false);
    expect(filterMatch(work, { availability: ["available"] })).toBe(true);
    expect(filterMatch(work, { availability: ["avail"] })).toBe(false);
    expect(filterMatch(work, { availability: ["sold"] })).toBe(false);
  });

  it("does not match or facet a field the Catalogue does not record", () => {
    const withoutMedium = filterFields();
    withoutMedium.medium = false;
    expect(
      matchesArtworkFilters(work, { medium: ["canvas"] }, withoutMedium),
    ).toBe(false);
    expect(artworkFacets([work], ["medium"], withoutMedium)).toEqual({
      medium: [],
    });
    const withoutAvailability = filterFields();
    withoutAvailability.availability = false;
    expect(
      matchesArtworkFilters(
        work,
        { availability: ["available"] },
        withoutAvailability,
      ),
    ).toBe(false);
  });

  it("lets a field with no value fail its filter, and ignores an empty one", () => {
    expect(filterMatch(work, { serie: ["Coastal"] })).toBe(false);
    // An absent availability is not the empty string: a filter names a state.
    expect(
      filterMatch({ title: "Untitled" }, { availability: ["available"] }),
    ).toBe(false);
    expect(filterMatch(work, { artistName: [] })).toBe(true);
  });
});

describe("facet counts", () => {
  const works = [
    {
      artistName: "Pablo Picasso",
      title: "A",
      status: "published" as const,
      availability: "available" as const,
    },
    {
      artistName: "Pablo Picasso",
      title: "B",
      status: "draft" as const,
      availability: null,
    },
    {
      artistName: "Dalí",
      title: "C",
      status: "published" as const,
      availability: "sold" as const,
    },
  ];

  it("counts each value of the field over the given set, normalized", () => {
    expect(facetCount(works, ["artistName"])).toEqual({
      artistName: [
        { value: "pablo picasso", count: 2 },
        { value: "dali", count: 1 },
      ],
    });
  });

  it("counts an enumerated field by its stored value and leaves an absent one out", () => {
    expect(facetCount(works, ["status", "availability"])).toEqual({
      status: [
        { value: "published", count: 2 },
        { value: "draft", count: 1 },
      ],
      availability: [
        { value: "available", count: 1 },
        { value: "sold", count: 1 },
      ],
    });
  });

  it("orders by count descending, then value ascending", () => {
    const tied = [
      { artistName: "Monet" },
      { artistName: "Dalí" },
      { artistName: "Monet" },
      { artistName: "Cézanne" },
    ];
    expect(facetCount(tied, ["artistName"]).artistName).toEqual([
      { value: "monet", count: 2 },
      { value: "cezanne", count: 1 },
      { value: "dali", count: 1 },
    ]);
  });

  it("answers an empty list for a field with no values, and skips blank text", () => {
    expect(facetCount([], ["title"])).toEqual({ title: [] });
    expect(
      facetCount([{ title: "  " }, { title: null }], ["title"]).title,
    ).toEqual([]);
  });

  it(`caps each field at ${MAX_FACET_VALUES} values, keeping the most frequent`, () => {
    const many = Array.from({ length: MAX_FACET_VALUES + 1 }, (_, i) => ({
      title: `work-${String(i).padStart(3, "0")}`,
    }));
    const facet = facetCount(many, ["title"]).title ?? [];
    expect(facet).toHaveLength(MAX_FACET_VALUES);
    expect(facet[0]?.value).toBe("work-000");
    expect(facet.at(-1)?.value).toBe("work-499");
  });
});

describe("the list's order", () => {
  const at = (iso: string) => new Date(iso);
  const work = (
    id: string,
    updatedAt: string,
    fields: Partial<ArtworkSortable> = {},
  ): ArtworkSortable => ({
    id,
    title: "Untitled",
    artistName: "Unknown",
    updatedAt: at(updatedAt),
    ...fields,
  });

  const ids = (
    works: ArtworkSortable[],
    sort: "updated" | "title" | "artistName" | "dateOfCreation",
  ) =>
    [...works]
      .sort((a, b) => compareArtworksForList(a, b, sort))
      .map((w) => w.id);

  it("puts the most recently updated first, and breaks a tie by id", () => {
    const works = [
      work("b", "2026-01-02T00:00:00.000Z"),
      work("a", "2026-01-03T00:00:00.000Z"),
      work("c", "2026-01-02T00:00:00.000Z"),
    ];
    expect(ids(works, "updated")).toEqual(["a", "b", "c"]);
  });

  it("orders a text field case- and accent-blind, and breaks a tie by id", () => {
    const works = [
      work("d", "2026-01-01T00:00:00.000Z", { title: "Zebra" }),
      work("c", "2026-01-01T00:00:00.000Z", { title: "étude" }),
      work("b", "2026-01-01T00:00:00.000Z", { title: "Ete" }),
      work("a", "2026-01-01T00:00:00.000Z", { title: "Été" }),
    ];
    expect(ids(works, "title")).toEqual(["a", "b", "c", "d"]);
  });

  it("orders artist name and date of creation the same way", () => {
    const works = [
      work("b", "2026-01-01T00:00:00.000Z", {
        artistName: "Picasso",
        dateOfCreation: "circa 1900",
      }),
      work("a", "2026-01-01T00:00:00.000Z", {
        artistName: "Dalí",
        dateOfCreation: "1889",
      }),
    ];
    expect(ids(works, "artistName")).toEqual(["a", "b"]);
    expect(ids(works, "dateOfCreation")).toEqual(["a", "b"]);
  });
});
