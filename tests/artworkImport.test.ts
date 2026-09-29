import { describe, expect, it } from "vitest";
import {
  buildImportRows,
  guessColumnMapping,
  isMappingComplete,
  matchHeader,
  parseAcquisitionDate,
  toImportArtwork,
  validateImportRow,
  type ColumnMapping,
  type ImportRowValues,
} from "../src/schemas/artworkImport";

const row = (overrides: Partial<ImportRowValues>): ImportRowValues => ({
  title: "Nocturne",
  artistName: "Whistler",
  serie: "",
  dateOfCreation: "",
  media: "",
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
    expect(matchHeader("medium")).toBe("media");
    expect(matchHeader("Purchased Date")).toBe("acquisitionDate");
    expect(matchHeader("price paid")).toBe("acquisitionPrice");
    expect(matchHeader("created")).toBe("dateOfCreation");
    expect(matchHeader("notes")).toBe("notes");
  });

  it("collapses punctuation around header words", () => {
    expect(matchHeader("place of origin")).toBe("placeOfOrigin");
    expect(matchHeader(" current value ")).toBe("currentValue");
  });
});

describe("guessColumnMapping", () => {
  it("maps unambiguous headers and skips noise", () => {
    const mapping = guessColumnMapping([
      "title",
      "buyer-name", // unmapped, ignored
      "artist",
      "medium",
    ]);
    expect(mapping).toEqual({
      0: "title",
      2: "artistName",
      3: "media",
    });
  });

  it("gives the first column the field when two columns look alike", () => {
    const mapping = guessColumnMapping(["artist", "artist name", "title"]);
    const fields = Object.values(mapping);
    expect(fields.filter((f) => f === "artistName")).toHaveLength(1);
  });

  it("never assigns the same field twice", () => {
    const mapping = guessColumnMapping(["date", "year", "created"]);
    const fields = Object.values(mapping);
    expect(fields.filter((f) => f === "dateOfCreation")).toHaveLength(1);
  });
});

describe("isMappingComplete", () => {
  it("requires title and artistName", () => {
    const complete: ColumnMapping = { 0: "title", 1: "artistName", 2: "media" };
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
      media: "",
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

describe("toImportArtwork", () => {
  it("never emits undefined for a blank optional field", () => {
    const doc = toImportArtwork(row({}), "collection-1", "user-1");
    // Firestore rejects an explicit `undefined` property value on write (the
    // exact failure that bubbled out of WriteBatch.set() during a real
    // import), so the document must be free of them for any value the row can
    // produce — the `row()` helper blanks every optional field.
    for (const value of Object.values(doc)) {
      expect(value).not.toBeUndefined();
    }
    expect(doc).not.toHaveProperty("editions");
    expect(doc).not.toHaveProperty("serie");
  });

  it("shares the single-artwork write shape (ownership, public, storage)", () => {
    const doc = toImportArtwork(
      row({ title: "Nocturne", artistName: "Whistler" }),
      "collection-1",
      "user-1",
    );
    expect(doc.collectionId).toBe("collection-1");
    expect(doc.userId).toBe("user-1");
    expect(doc.isPublic).toBe(true);
    expect(doc.certificates).toEqual([]);
    expect(doc.photos).toEqual([]);
    expect(doc.title).toBe("Nocturne");
    expect(doc.artistName).toBe("Whistler");
  });
});
