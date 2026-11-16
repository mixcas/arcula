/**
 * The caps and accepted-type maps, shared by every side that enforces them.
 *
 * The web client enforces these in the Add/Edit forms through
 * `checkDeclaredUpload` — a file that fails a cap or the allowlist is rejected
 * before it is uploaded — and the API asks the same guard at presign, where a
 * hand-rolled client cannot bypass it. Importing them from here is what keeps
 * every enforcer in agreement, by construction.
 */

/**
 * How many distinct fallback code points one catalogue PDF font-subset
 * request may carry. The export chunks the document's set at this size and
 * the API refuses anything larger, so the two sides cannot drift.
 */
export const MAX_PDF_FALLBACK_CODE_POINTS = 512;

/** Hard cap on images per artwork. Enforced in the form and by the API. */
export const MAX_ARTWORK_PHOTOS = 10;

/**
 * Per-file size cap.
 *
 * The API enforces the same ceiling, so a file may hit it exactly rather than
 * be rejected a byte under.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Image types the form accepts. Mirrored in the Dropzone `accept` map. */
export const ACCEPTED_IMAGE_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

/**
 * The form's first gate on a picked file: its reported type must be one the
 * form accepts. An unclassifiable file (`undefined`) fails, which is the safe
 * direction — the stage route re-checks the same list server-side, so the
 * client check only ever saves a round trip, never weakens the boundary.
 */
export const isAcceptedImageType = (type: string | undefined): boolean =>
  type !== undefined && type in ACCEPTED_IMAGE_TYPES;

/** Hard cap on documents per artwork. Enforced in the form and by the API. */
export const MAX_ARTWORK_DOCUMENTS = 10;

/**
 * Per-file size cap for a document.
 *
 * Deliberately larger than `MAX_IMAGE_BYTES`. A scanned catalogue raisonné or a
 * high-resolution condition report is a normal thing to attach to a work and is
 * routinely larger than a photograph, and 10 MiB would reject it in the form
 * with no way to proceed.
 *
 * The API enforces the same ceiling, so a file may hit it exactly rather than
 * be rejected a byte under.
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * The types the form accepts, for the Dropzone `accept` map.
 *
 * Images plus PDF, and nothing else. The narrower this list is, the fewer
 * things can be handed a browser to render — SVG and HTML are the two that
 * matter here, because both execute when navigated to directly, and neither
 * appears below.
 *
 * That is a real control, not a complete one: `contentType` is supplied by the
 * client and is forgeable. The API re-checks the declared type against this
 * list at the stage boundary.
 */
export const ACCEPTED_DOCUMENT_TYPES: Record<string, string[]> = {
  ...ACCEPTED_IMAGE_TYPES,
  "application/pdf": [".pdf"],
};

/**
 * Which of the two media populations a declaration is judged against.
 *
 * The singular — `photo` / `document` — because that is the name everything
 * that holds a population uses: the API's row tables and variants, the
 * `parentKind` a stored object records, and the save payloads' two arrays.
 * The PLURAL (`photos` / `documents`) is the wire's and the object key's name
 * for the same population, and the API's `kindOf` is the one place that
 * translates between them.
 */
export type MediaPopulationKind = "photo" | "document";

/**
 * Each population's ceiling and allowlist, mapped to the tables above and
 * never restated: there is no type name and no byte count written below, so
 * this record cannot drift from the form's Dropzone or the API's own table.
 */
const DECLARED_UPLOAD_RULES: Record<
  MediaPopulationKind,
  { accepted: Record<string, string[]>; cap: number }
> = {
  photo: { accepted: ACCEPTED_IMAGE_TYPES, cap: MAX_IMAGE_BYTES },
  document: { accepted: ACCEPTED_DOCUMENT_TYPES, cap: MAX_DOCUMENT_BYTES },
};

/**
 * Why a declared upload was refused — and `allowed` when it was not.
 *
 * The refusal is named rather than narrowed to `false` because the two
 * failures reach the person differently ("that type is not accepted" versus
 * "that file is too large"), and because the type is what decides whether an
 * extension — hence the object's name — is minted at all. Both sides map a
 * verdict to their own wording; neither re-derives the decision.
 */
export type DeclaredUploadVerdict =
  "allowed" | "unsupported-type" | "too-large" | "invalid-size";

/**
 * The declared-upload guard: is this `(population, contentType, size)` legal?
 *
 * A direct-to-storage upload never carries the bytes to the API, so the only
 * thing the presign step can judge is what the client DECLARES — and this is
 * the one function that judges it, asked by both form hooks before they commit
 * to an upload and by the API before it mints a URL. The bytes themselves are
 * re-checked at process, where the server first sees them.
 *
 * The order is the stage route's existing one, kept: the allowlist first, so a
 * forged type is reported as a type failure rather than as an honest file that
 * is too big. The cap is inclusive on both ends — a file may hit it exactly
 * rather than be refused a byte under.
 */
export const checkDeclaredUpload = (
  population: MediaPopulationKind,
  contentType: string,
  size: number,
): DeclaredUploadVerdict => {
  const rule = DECLARED_UPLOAD_RULES[population];
  // An own-property question, not `in`: the allowlists are object literals, so
  // `"toString" in ACCEPTED_IMAGE_TYPES` is true and a prototype key would be
  // admitted as a type.
  if (!Object.hasOwn(rule.accepted, contentType)) return "unsupported-type";
  // A byte count has to be a positive whole number before `> cap` means
  // anything: `NaN` compares false against every cap, and a fractional or
  // negative one is a malformed declaration rather than a large file.
  if (!Number.isSafeInteger(size) || size < 1) return "invalid-size";
  if (size > rule.cap) return "too-large";
  return "allowed";
};
