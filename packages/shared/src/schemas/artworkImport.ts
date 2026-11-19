import { z } from "zod";
import {
  ARTWORK_FIXED_FIELDS,
  type ArtworkFieldStates,
  type ArtworkFixedField,
} from "../artworkFields";
import type { ArtworkStatus } from "../types";
import { artworkSchema, type ArtworkFormValues } from "./artwork";

/**
 * Pure logic for the CSV artwork-import flow (`/manage/catalogue/:id/import/csv`).
 *
 * Nothing in this module touches React or the filesystem: every
 * step of the pipeline — header-to-field guessing, cell normalization, date
 * conversion, and per-row validation against the same `artworkSchema` the
 * Add/Edit forms use — is a plain function so it can be unit-tested in
 * `tests/artworkImport.test.ts` and reused by the stepper steps.
 *
 * The pipeline margin of design (import "steps"):
 *   1. `guessColumnMapping` — auto-map CSV headers to artwork fields.
 *   2. `buildImportRows` — clean every cell (trim, drop blanks, convert mapped
 *      dates) BEFORE the review table renders it.
 *   3. `validateImportRow` — computed live so the review step always reflects
 *      the user's latest edits. The only title rule is that a Title exists:
 *      same-title works are legitimate in art, so titles are never compared
 *      against each other or against the catalogue's existing artworks.
 * The run step's remaining job is to POST the selected rows to the API's
 * import route and render its `{ inserted, rejected }` answer — the server
 * validates each row against this same `artworkSchema`, so an imported work
 * lands byte-identical to one created by hand.
 *
 * `status` is not a mappable column: it is the batch's, not a row's, and the
 * review step's default is `IMPORTED_WORK_STATUS` (`published`). A caller that
 * names a status — the agent surface's import always sends `draft` — overrides
 * any status a row carries; a member's CSV import sends none and is unchanged.
 */

// ---------------------------------------------------------------------------
// Field metadata
// ---------------------------------------------------------------------------

/**
 * The status an import lands its works with when the caller names none:
 * `published`. It is the DEFAULT, not the only answer — a payload may name
 * `draft` and then the payload wins, and the agent surface's `import_artworks`
 * always sends `draft`. One constant, because the review's per-row check and
 * the route's write must agree.
 */
export const IMPORTED_WORK_STATUS: ArtworkStatus = "published";

/** Every writable artwork field an import may populate. */
const IMPORTABLE_KEYS = [
  "title",
  "artistName",
  "serie",
  "dateOfCreation",
  "medium",
  "dimensions",
  "editions",
  "acquisitionDate",
  "acquisitionPrice",
  "placeOfOrigin",
  "provenance",
  "notes",
  "condition",
  "currentValue",
] as const;

export type ImportFieldKey = (typeof IMPORTABLE_KEYS)[number];

export type ImportFieldKind = "text" | "multiline" | "date";

export interface ImportFieldMetadata {
  key: ImportFieldKey;
  label: string;
  required: boolean;
  kind: ImportFieldKind;
}

/**
 * Ordered as the schema's fields so the review table reads left-to-right like
 * the Add/Edit form. Only `acquisitionDate` is a strict date; everything else —
 * including `dateOfCreation`, which stays free text ("circa 1889") by design —
 * is carried through trimmed.
 */
export const ARTWORK_IMPORT_FIELDS: readonly ImportFieldMetadata[] = [
  { key: "title", label: "Title", required: true, kind: "text" },
  { key: "artistName", label: "Artist name", required: true, kind: "text" },
  { key: "serie", label: "Serie", required: false, kind: "text" },
  {
    key: "dateOfCreation",
    label: "Date of creation",
    required: false,
    kind: "text",
  },
  { key: "medium", label: "Medium", required: false, kind: "text" },
  { key: "dimensions", label: "Dimensions", required: false, kind: "text" },
  { key: "editions", label: "Editions", required: false, kind: "text" },
  {
    key: "acquisitionDate",
    label: "Acquisition date",
    required: false,
    kind: "date",
  },
  {
    key: "acquisitionPrice",
    label: "Acquisition price",
    required: false,
    kind: "text",
  },
  {
    key: "placeOfOrigin",
    label: "Place of origin",
    required: false,
    kind: "text",
  },
  { key: "provenance", label: "Provenance", required: false, kind: "text" },
  { key: "notes", label: "Notes", required: false, kind: "multiline" },
  { key: "condition", label: "Condition", required: false, kind: "text" },
  {
    key: "currentValue",
    label: "Current price",
    required: false,
    kind: "text",
  },
];

export const IMPORT_FIELD_BY_KEY: Record<ImportFieldKey, ImportFieldMetadata> =
  Object.fromEntries(
    ARTWORK_IMPORT_FIELDS.map((field) => [field.key, field]),
  ) as Record<ImportFieldKey, ImportFieldMetadata>;

// Compile-time guard: every importable key must really be a writable form
// field, so a schema field rename surfaces here instead of at runtime.
type ImportableKeysValid = ImportFieldKey extends keyof ArtworkFormValues
  ? true
  : never;
const importableKeysValid: ImportableKeysValid = true;
// Runtime guard: every key must have field metadata, so the mapping UI offers
// exactly the writable surface and nothing more.
const importableKeysCovered = IMPORTABLE_KEYS.every(
  (key) => IMPORT_FIELD_BY_KEY[key] !== undefined,
);
void importableKeysValid;
void importableKeysCovered;

/**
 * The fixed fields are never switches, so an import may always target them.
 * Derived from the registry's `ARTWORK_FIXED_FIELDS` rather than a second list,
 * so the two vocabularies cannot part; the predicate stays sound because a key
 * that matches one of the fixed names is that field.
 */
const isFixedImportField = (key: ImportFieldKey): key is ArtworkFixedField =>
  ARTWORK_FIXED_FIELDS.some((fixed) => fixed === key);

/**
 * The mapping targets a catalogue records, in the form's order: Title and
 * Artist Name always, every other field only when its key is enabled. Pure by
 * design — the mapping step renders exactly this list, so a disabled field has
 * no option to pick.
 */
export const enabledImportFields = (
  enabled: ArtworkFieldStates,
): ImportFieldMetadata[] =>
  ARTWORK_IMPORT_FIELDS.filter(
    (field) => isFixedImportField(field.key) || enabled[field.key],
  );

/**
 * The mapping-target keys a catalogue records, in the same form order the
 * mapping step offers: Title and Artist Name always, every other field only
 * when its key is enabled. Auto-mapping and the skipped-column summary read
 * this one set, so the two cannot disagree about what can land.
 */
const enabledImportFieldKeys = (
  enabled: ArtworkFieldStates,
): ReadonlySet<ImportFieldKey> =>
  new Set(enabledImportFields(enabled).map(({ key }) => key));

/** The raw values of one imported row, all strings — "" means "not set". */
export interface ImportRowValues {
  title: string;
  artistName: string;
  serie: string;
  dateOfCreation: string;
  medium: string;
  dimensions: string;
  editions: string;
  acquisitionDate: string;
  acquisitionPrice: string;
  placeOfOrigin: string;
  provenance: string;
  notes: string;
  condition: string;
  currentValue: string;
}

const createEmptyImportRowValues = (): ImportRowValues => ({
  title: "",
  artistName: "",
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
});

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

/**
 * CSV column index → artwork field. An index with no entry (or `undefined`)
 * means that column is not imported.
 */
export type ColumnMapping = Partial<Record<number, ImportFieldKey>>;

/** Lowercase, punctuation collapsed to single spaces, trimmed. */
const normalizeHeader = (header: string): string =>
  header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Header words the field names do not already cover. Keys are normalized
 * (`normalizeHeader` output); the first column matching a field wins.
 */
const HEADER_ALIASES: Record<string, ImportFieldKey> = {
  title: "title",
  name: "title",
  artist: "artistName",
  "artist name": "artistName",
  author: "artistName",
  creator: "artistName",
  by: "artistName",
  serie: "serie",
  series: "serie",
  date: "dateOfCreation",
  "date of creation": "dateOfCreation",
  "creation date": "dateOfCreation",
  "date created": "dateOfCreation",
  created: "dateOfCreation",
  year: "dateOfCreation",
  media: "medium",
  medium: "medium",
  technique: "medium",
  material: "medium",
  materials: "medium",
  dimensions: "dimensions",
  dimension: "dimensions",
  size: "dimensions",
  sizes: "dimensions",
  measurements: "dimensions",
  editions: "editions",
  edition: "editions",
  "edition number": "editions",
  acquired: "acquisitionDate",
  "acquisition date": "acquisitionDate",
  "date acquired": "acquisitionDate",
  "purchase date": "acquisitionDate",
  "purchased date": "acquisitionDate",
  "acquisition price": "acquisitionPrice",
  "purchase price": "acquisitionPrice",
  "price paid": "acquisitionPrice",
  price: "acquisitionPrice",
  cost: "acquisitionPrice",
  "place of origin": "placeOfOrigin",
  origin: "placeOfOrigin",
  place: "placeOfOrigin",
  provenance: "provenance",
  history: "provenance",
  notes: "notes",
  note: "notes",
  comments: "notes",
  condition: "condition",
  "current value": "currentValue",
  value: "currentValue",
  "estimated value": "currentValue",
};

/**
 * Best-guess field for one header, or null when nothing looks like it.
 * Exact normalized header first, then the field key names themselves
 * ("artistName" → "artist name"), then nothing.
 */
export const matchHeader = (header: string): ImportFieldKey | null => {
  const normalized = normalizeHeader(header);
  const aliased = HEADER_ALIASES[normalized];
  if (aliased) {
    return aliased;
  }
  const byKey = ARTWORK_IMPORT_FIELDS.find(
    (field) => normalizeHeader(field.key) === normalized,
  );
  return byKey?.key ?? null;
};

/**
 * Auto-mapping: each field goes to the FIRST header that matches it. Columns
 * that match nothing — and columns whose field the catalogue does not record —
 * stay unmapped rather than forcing a guess the import could not honour.
 */
export const guessColumnMapping = (
  headers: string[],
  enabled: ArtworkFieldStates,
): ColumnMapping => {
  const allowed = enabledImportFieldKeys(enabled);
  const used = new Set<ImportFieldKey>();
  const mapping: ColumnMapping = {};
  headers.forEach((header, index) => {
    const field = matchHeader(header);
    if (field && allowed.has(field) && !used.has(field)) {
      mapping[index] = field;
      used.add(field);
    }
  });
  return mapping;
};

/** A column the import leaves alone because the catalogue does not record its
 *  natural field. `header` is the CSV's own text; `field` is what it would
 *  have imported as. */
export interface SkippedImportColumn {
  column: number;
  header: string;
  field: ImportFieldKey;
}

/**
 * The CSV columns a catalogue's field set leaves unmapped, named so the run
 * summary can say which parts of the file were not imported. Computed from the
 * headers and the enabled set alone: a skipped column is not a row failure, so
 * nothing here looks at the data.
 */
export const skippedImportColumns = (
  headers: string[],
  enabled: ArtworkFieldStates,
): SkippedImportColumn[] => {
  const allowed = enabledImportFieldKeys(enabled);
  const skipped: SkippedImportColumn[] = [];
  headers.forEach((header, column) => {
    const field = matchHeader(header);
    if (field && !allowed.has(field)) {
      skipped.push({ column, header: header.trim(), field });
    }
  });
  return skipped;
};

export const getMappedFields = (mapping: ColumnMapping): ImportFieldKey[] =>
  ARTWORK_IMPORT_FIELDS.map((field) => field.key).filter((key) =>
    Object.values(mapping).includes(key),
  );

/** Whether the two schema-required fields have a column each. */
export const isMappingComplete = (mapping: ColumnMapping): boolean =>
  Object.values(mapping).includes("title") &&
  Object.values(mapping).includes("artistName");

// ---------------------------------------------------------------------------
// Date normalization (acquisitionDate only)
// ---------------------------------------------------------------------------

export interface ParsedAcquisitionDate {
  ok: boolean;
  /** Normalized `YYYY-MM-DD`; absent when the cell was empty. */
  value?: string;
  /**
   * Present when the value was converted (bare year, slashed date, ...) so the
   * review step can show "converted from X" and the user can verify it.
   */
  from?: string;
}

const isoDate = z.iso.date();

const DMY_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number): number =>
  [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ];

const isValidCalendarDate = (
  year: number,
  month: number,
  day: number,
): boolean =>
  month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);

/**
 * Normalize an `acquisitionDate` cell to the schema's `YYYY-MM-DD`.
 *
 * Accepted inputs:
 *  - canonical `YYYY-MM-DD` (passes `z.iso.date`, so impossible dates like
 *    2024-02-30 are rejected),
 *  - a bare year (`2024` → `2024-01-01`; the schema stores only full dates, and
 *    the conversion is surfaced via `from`),
 *  - a year-first `YYYY/M/D` (unpadded ISO — a common spreadsheet export; the
 *    leading 4-digit year disambiguates it from the DMY/MDY forms below),
 *  - `D/M/YYYY` / `M/D/YYYY` with `-`, `/` or `.` separators — resolved by the
 *    per-value heuristic: whichever part exceeds 12 is unambiguous, and when
 *    both parts could be a month the value is read day-first (the common
 *    European/CSV-export convention). The `from` note exposes the choice back
 *    to the user in the review step.
 */
export const parseAcquisitionDate = (raw: string): ParsedAcquisitionDate => {
  const value = raw.trim();
  if (value === "") {
    return { ok: true };
  }

  if (isoDate.safeParse(value).success) {
    return { ok: true, value };
  }

  if (/^\d{4}$/.test(value)) {
    return { ok: true, value: `${value}-01-01`, from: value };
  }

  // Year-first YYYY/M/D: the leading 4-digit year makes the order
  // unambiguous even when the month/day digits could be read either way.
  const yearFirst = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(value);
  if (yearFirst) {
    const year = Number(yearFirst[1]);
    const month = Number(yearFirst[2]);
    const day = Number(yearFirst[3]);
    if (!isValidCalendarDate(year, month, day)) {
      return { ok: false };
    }
    const normalized = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!isoDate.safeParse(normalized).success) {
      return { ok: false };
    }
    return { ok: true, value: normalized, from: value };
  }

  const match = DMY_DATE.exec(value);
  if (!match) {
    return { ok: false };
  }

  let day = Number(match[1]);
  const monthCandidate = Number(match[2]);
  const secondIsDay = monthCandidate > 12;
  const firstIsDay = day > 12;
  let month = monthCandidate;
  if (secondIsDay) {
    day = monthCandidate;
    month = Number(match[1]);
  } else if (firstIsDay) {
    // already day-first
  } else {
    // both could be a month → day-first, documented default
  }

  const year = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) {
    return { ok: false };
  }

  const normalized = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!isoDate.safeParse(normalized).success) {
    return { ok: false };
  }
  return { ok: true, value: normalized, from: value };
};

// ---------------------------------------------------------------------------
// Row building + validation
// ---------------------------------------------------------------------------

export interface ImportRow {
  /** Stable per-row identity for table selection and cell edits. */
  rowId: string;
  values: ImportRowValues;
  /**
   * The original `acquisitionDate` cell when it was converted, for the
   * "converted from …" tooltip in the review step.
   */
  acquisitionDateFrom?: string;
}

/** Clean one cell: trim; blank means "field not set" (kept as ""). */
const cleanText = (raw: string): string => raw.trim();

const fieldColumnIndex = (
  mapping: ColumnMapping,
): Partial<Record<ImportFieldKey, number>> => {
  const byField: Partial<Record<ImportFieldKey, number>> = {};
  for (const [column, field] of Object.entries(mapping)) {
    if (field) {
      byField[field] = Number(column);
    }
  }
  return byField;
};

/**
 * Build one `ImportRow` per CSV data row. All cleaning happens here, before
 * the review table sees anything: every string is trimmed, every mapped date
 * is normalized (or kept raw for the validation to flag), and blank cells drop
 * out as "".
 */
export const buildImportRows = (
  headers: string[],
  dataRows: string[][],
  mapping: ColumnMapping,
): ImportRow[] => {
  void headers;
  const byField = fieldColumnIndex(mapping);

  return dataRows.map((cells, rowIndex) => {
    const values = createEmptyImportRowValues();
    let acquisitionDateFrom: string | undefined;

    for (const field of ARTWORK_IMPORT_FIELDS) {
      const column = byField[field.key];
      if (column === undefined) {
        continue;
      }
      const raw = cleanText(cells[column] ?? "");

      if (field.kind === "date") {
        const parsed = parseAcquisitionDate(raw);
        if (parsed.ok) {
          if (parsed.value) {
            values[field.key] = parsed.value;
          }
          acquisitionDateFrom = parsed.from;
        } else {
          // Keep what was typed so the review step can flag and fix it.
          values[field.key] = raw;
        }
      } else if (raw !== "") {
        values[field.key] = raw;
      }
    }

    return {
      rowId: `row-${rowIndex}`,
      values,
      acquisitionDateFrom,
    };
  });
};

export interface ImportRowIssue {
  field: ImportFieldKey;
  message: string;
}

/**
 * A row ready for the review table: the cleaned values plus the live
 * validation state (`issues`) that the import gate and row highlighting
 * derive from. There is no duplicate-title state by design — same-title works
 * are legitimate in art, so titles are never compared.
 */
export interface ReviewRow extends ImportRow {
  issues: ImportRowIssue[];
}

/** A row that may be imported as-is. */
export const isRowImportable = (row: ReviewRow): boolean =>
  row.issues.length === 0;

/**
 * Validate all rows so the review table shows everything up to date after
 * every cell edit.
 */
export const attachIssues = (rows: ImportRow[]): ReviewRow[] =>
  rows.map((row) => ({
    ...row,
    issues: validateImportRow(row.values),
  }));

/**
 * Validate one row against the same schema as the Add/Edit forms. The schema's
 * messages are reused verbatim so the fix instructions match everywhere, and
 * `status` is pinned to the app-wide default.
 */
export const validateImportRow = (
  values: ImportRowValues,
): ImportRowIssue[] => {
  const parsed = artworkSchema.safeParse({
    ...values,
    status: IMPORTED_WORK_STATUS,
  });
  if (parsed.success) {
    return [];
  }
  return parsed.error.issues.map((issue) => ({
    field: issue.path[0] as ImportFieldKey,
    message: issue.message,
  }));
};
