import { describe, expect, it } from "vitest";
import { parseCsvText } from "../src/utils/csv";

describe("parseCsvText", () => {
  it("parses a simple header + rows", () => {
    const { data, errors } = parseCsvText("title,artist\na,b\nc,d\n");
    expect(errors).toEqual([]);
    expect(data).toEqual([
      ["title", "artist"],
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops fully empty rows but keeps rows with partial content", () => {
    const { data } = parseCsvText("a,b\n\n,\na,\n");
    // The all-empty `,` row cannot become an artwork, so it is dropped along
    // with the physically-blank line; a row with one empty cell is kept.
    expect(data).toEqual([
      ["a", "b"],
      ["a", ""],
    ]);
  });

  it("handles quoted fields with embedded commas and newlines", () => {
    const { data, errors } = parseCsvText(
      'title,notes\n"A, B","line one\nline two"\n',
    );
    expect(errors).toEqual([]);
    expect(data).toEqual([
      ["title", "notes"],
      ["A, B", "line one\nline two"],
    ]);
  });

  it("sniffs a semicolon delimiter", () => {
    expect(parseCsvText("a;b\n1;2\n").data).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips the UTF-8 BOM from the first cell", () => {
    const { data } = parseCsvText("\uFEFFtitle,artist\nx,y\n");
    expect(data[0][0]).toBe("title");
  });

  it("keeps ragged rows in place for the caller to judge", () => {
    const { data } = parseCsvText("a,b,c\n1,2\n");
    expect(data).toEqual([
      ["a", "b", "c"],
      ["1", "2"],
    ]);
    expect(data[1]).toHaveLength(2);
  });

  it("surfaces malformed quotes as errors without dropping data", () => {
    const { data, errors } = parseCsvText('a,b\n"unclosed,b\n');
    expect(errors.length).toBeGreaterThan(0);
    // papaparse still yields a best-effort row for the bad line.
    expect(data.length).toBeGreaterThanOrEqual(1);
  });
});
