import Papa from "papaparse";

/**
 * CSV reading for the bulk-import flow.
 *
 * The file is read in the browser tab only — nothing here uploads to a server.
 * papaparse handles the messiness of real-world CSVs (Excel/Sheets exports):
 * BOMs, CRLF line endings, quoted fields containing commas/newlines, and
 * delimiter sniffing. It also reports parse-level problems (e.g. malformed
 * quoting) via `errors`, which the import UI surfaces as a warning.
 *
 * `header: false` keeps every row as a plain `string[]`, leaving the
 * header-vs-data split to the calling page so it can offer the "first row is a
 * header" toggle. Cells keep their raw text here; cleaning, trimming and date
 * conversion happen later in `src/schemas/artworkImport.ts`.
 */

export interface ParsedCsv {
  /** Every row including the header row, when present. */
  data: string[][];
  /** papaparse failures that are worth warning about (quotes, etc.). */
  errors: Papa.ParseError[];
}

export const parseCsvText = (text: string): ParsedCsv => {
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";", "\t", "|"],
    transform: (value) => value.replace(/^\uFEFF/, ""),
  });
  return { data: result.data, errors: result.errors };
};
