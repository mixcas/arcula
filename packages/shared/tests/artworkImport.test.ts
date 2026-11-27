import { describe, expect, it } from "vitest";
import {
  ARTWORK_FIELD_KEYS,
  resolveArtworkFields,
  type ArtworkFieldStates,
} from "../src/artworkFields";
import {
  buildImportRows,
  enabledImportFields,
  guessColumnMapping,
  isMappingComplete,
  matchHeader,
  parseAcquisitionDate,
  skippedImportColumns,
  validateImportRow,
  type ColumnMapping,
  type ImportRowValues,
} from "../src/schemas/artworkImport";

// The whole import surface is every togglable field on, whichever the Kind's
// defaults are. The disabled cases below use a Portfolio, whose market fields
// start off.
const everyField = Object.fromEntries(
  ARTWORK_FIELD_KEYS.map((field) => [field, true]),
) as ArtworkFieldStates;
const portfolio = resolveArtworkFields("portfolio", null).enabled;

const row = (overrides: Partial<ImportRowValues>): ImportRowValues => ({
  title: "Nocturne",
  artistName: "Whistler",
  serie: "",
  dateOfCreation: "",
  medium: "",
  dimensions: "",
  editions: "",
  acquisitionDate: "",
  acquisitionPrice: "",
  placeOfOrigin: "",
  provenance: "",
  notes: "",
  condition: "",
  currentValue: "",
  ...overrides,
});

describe("matchHeader", () => {
  it("matches exact field names case-insensitively", () => {
    expect(matchHeader("title")).toBe("title");
    expect(matchHeader("Artist Name")).toBe("artistName");
    expect(matchHeader("coin")).toBeNull();
  });

  it("matches common spreadsheet synonyms", () => {
    expect(matchHeader("medium")).toBe("medium");
    expect(matchHeader("Purchased Date")).toBe("acquisitionDate");
    expect(matchHeader("price paid")).toBe("acquisitionPrice");
    expect(matchHeader("created")).toBe("dateOfCreation");
    expect(matchHeader("notes")).toBe("notes");
  });

  it("keeps the older spellings of the material mapped to medium", () => {
    for (const header of ["Media", "Technique", "Material", "Materials"]) {
      expect(matchHeader(header), `${header} should map to medium`).toBe(
        "medium",
      );
    }
  });

  it("collapses punctuation around header words", () => {
    expect(matchHeader("place of origin")).toBe("placeOfOrigin");
    expect(matchHeader(" current value ")).toBe("currentValue");
  });
});

describe("guessColumnMapping", () => {
  it("maps unambiguous headers and skips noise", () => {
    const mapping = guessColumnMapping(
      [
        "title",
        "buyer-name", // unmapped, ignored
        "artist",
        "medium",
      ],
      everyField,
    );
    expect(mapping).toEqual({
      0: "title",
      2: "artistName",
      3: "medium",
    });
  });

  it("gives the first column the field when two columns look alike", () => {
    const mapping = guessColumnMapping(
      ["artist", "artist name", "title"],
      everyField,
    );
    const fields = Object.values(mapping);
    expect(fields.filter((f) => f === "artistName")).toHaveLength(1);
  });

  it("never assigns the same field twice", () => {
    const mapping = guessColumnMapping(["date", "year", "created"], everyField);
    const fields = Object.values(mapping);
    expect(fields.filter((f) => f === "dateOfCreation")).toHaveLength(1);
  });

  it("does not map a column whose field the catalogue does not record", () => {
    // The Portfolio's acquisition pair is off, so "price paid" has no target
    // to land in — while every other column still maps.
    const mapping = guessColumnMapping(
      ["title", "artist", "price paid", "medium"],
      portfolio,
    );
    expect(mapping).toEqual({
      0: "title",
      1: "artistName",
      3: "medium",
    });
  });
});

describe("enabledImportFields", () => {
  it("offers every field's own key and drops the disabled ones", () => {
    expect(enabledImportFields(everyField).map((field) => field.key)).toContain(
      "serie",
    );
    const offered = enabledImportFields(portfolio).map((field) => field.key);
    expect(offered).not.toContain("serie");
    expect(offered).not.toContain("acquisitionPrice");
    expect(offered).not.toContain("acquisitionDate");
  });

  it("keeps Title and Artist Name, which are never switches", () => {
    // Neither name exists in the resolved set: they are fixed fields, not
    // togglable ones, and an import that could not target them could not run.
    const offered = enabledImportFields(portfolio).map((field) => field.key);
    expect(offered).toContain("title");
    expect(offered).toContain("artistName");
  });
});

describe("skippedImportColumns", () => {
  it("names a column whose natural field the catalogue does not record", () => {
    expect(
      skippedImportColumns(
        ["Title", "Artist Name", "Acquisition price", "Medium"],
        portfolio,
      ),
    ).toEqual([
      { column: 2, header: "Acquisition price", field: "acquisitionPrice" },
    ]);
  });

  it("names nothing for a column the catalogue records or cannot place", () => {
    expect(
      skippedImportColumns(
        ["Title", "Artist Name", "Medium", "buyer-name"],
        portfolio,
      ),
    ).toEqual([]);
  });
});

describe("isMappingComplete", () => {
  it("requires title and artistName", () => {
    const complete: ColumnMapping = {
      0: "title",
      1: "artistName",
      2: "medium",
    };
    expect(isMappingComplete(complete)).toBe(true);
    expect(isMappingComplete({ 0: "title" })).toBe(false);
    expect(isMappingComplete({ 1: "artistName" })).toBe(false);
    expect(isMappingComplete({})).toBe(false);
  });
});

describe("parseAcquisitionDate", () => {
  it("passes an ISO date through unchanged", () => {
    expect(parseAcquisitionDate("2024-05-14")).toEqual({
      ok: true,
      value: "2024-05-14",
    });
  });

  it("treats an empty cell as unset", () => {
    expect(parseAcquisitionDate("")).toEqual({ ok: true });
    expect(parseAcquisitionDate("   ")).toEqual({ ok: true });
  });

  it("converts a bare year to January 1 and notes the conversion", () => {
    expect(parseAcquisitionDate("1889")).toEqual({
      ok: true,
      value: "1889-01-01",
      from: "1889",
    });
  });

  it("reads day-first when both parts could be a month", () => {
    // Ambiguous DD/MM vs MM/DD: both parts ≤ 12 → day-first by design.
    expect(parseAcquisitionDate("03/04/2024").value).toBe("2024-04-03");
  });

  it("resolves a part above 12 as the day", () => {
    // MM/DD with the second part being a day: 3/24/2024 → March 24.
    expect(parseAcquisitionDate("3/24/2024").value).toBe("2024-03-24");
  });

  it("resolves a part above 12 as the month (day first form)", () => {
    // DD/MM with the first part being a day: 24/03/2024 → March 24.
    expect(parseAcquisitionDate("24/03/2024").value).toBe("2024-03-24");
  });

  it("accepts dash and dot separators", () => {
    // Both parts can be a month → day-first by design: 1-2-2020 = Feb 1.
    expect(parseAcquisitionDate("1-2-2020").value).toBe("2020-02-01");
    expect(parseAcquisitionDate("5.6.2021").value).toBe("2021-06-05");
  });

  it("resolves an unpadded year-first ISO date", () => {
    expect(parseAcquisitionDate("2024-1-5").value).toBe("2024-01-05");
    expect(parseAcquisitionDate("2024-1-5").from).toBe("2024-1-5");
    // Impossible calendar dates stay rejected even in year-first order.
    expect(parseAcquisitionDate("2024-13-1")).toEqual({ ok: false });
  });

  it("rejects impossible and malformed dates", () => {
    expect(parseAcquisitionDate("2023-02-30")).toEqual({ ok: false });
    expect(parseAcquisitionDate("31/13/2020")).toEqual({ ok: false });
    expect(parseAcquisitionDate("circa 1889")).toEqual({ ok: false });
    expect(parseAcquisitionDate("nothing")).toEqual({ ok: false });
  });
});

describe("buildImportRows", () => {
  const headers = ["date", "title", "artist"];
  const mapping: ColumnMapping = {
    0: "acquisitionDate",
    1: "title",
    2: "artistName",
  };

  it("trims cells and drops blanks", () => {
    const rows = buildImportRows(
      headers,
      [["  2024-1-5 ", "  Nocturne ", " Whistler "]],
      mapping,
    );
    expect(rows[0].values).toMatchObject({
      acquisitionDate: "2024-01-05",
      title: "Nocturne",
      artistName: "Whistler",
    });
  });

  it("keeps a bad date raw so validation can flag it", () => {
    const rows = buildImportRows(headers, [["nope", "x", "y"]], mapping);
    expect(rows[0].values.acquisitionDate).toBe("nope");
    expect(rows[0].acquisitionDateFrom).toBeUndefined();
  });

  it("notes a date conversion for the review tooltip", () => {
    const rows = buildImportRows(headers, [["1/2/2020", "x", "y"]], mapping);
    // Both parts can be a month → day-first by design: 1/2/2020 = Feb 1.
    expect(rows[0].values.acquisitionDate).toBe("2020-02-01");
    expect(rows[0].acquisitionDateFrom).toBe("1/2/2020");
  });

  it("ignores unmapped columns", () => {
    const rows = buildImportRows(
      headers,
      [["2024-01-01", "x", "y", "junk"]],
      mapping,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].values.serie).toBe("");
  });

  it("handles rows shorter than the header row", () => {
    const rows = buildImportRows(headers, [["2024-01-01"]], mapping);
    expect(rows[0].values.title).toBe("");
    expect(rows[0].values.artistName).toBe("");
  });
});

describe("validateImportRow", () => {
  it("accepts a filled row", () => {
    expect(validateImportRow(row({}))).toEqual([]);
  });

  it("flags the missing required fields by field name", () => {
    const issues = validateImportRow(row({ title: "", artistName: "" }));
    const fields = issues.map((i) => i.field);
    expect(fields).toContain("title");
    expect(fields).toContain("artistName");
  });

  it("flags an invalid acquisitionDate", () => {
    const issues = validateImportRow(row({ acquisitionDate: "not-a-date" }));
    expect(issues.some((i) => i.field === "acquisitionDate")).toBe(true);
  });

  it("accepts blanks for every optional field", () => {
    const blankRow = row({
      serie: "",
      dateOfCreation: "",
      medium: "",
      dimensions: "",
      editions: "",
      acquisitionPrice: "",
      placeOfOrigin: "",
      provenance: "",
      notes: "",
      condition: "",
      currentValue: "",
    });
    expect(validateImportRow(blankRow)).toEqual([]);
  });
});
