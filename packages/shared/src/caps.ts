/**
 * The caps and accepted-type maps, shared by every side that enforces them.
 *
 * The web client enforces these in the Add/Edit forms — a file that fails a
 * cap is rejected before it is decoded or uploaded — and the API enforces the
 * same ceilings at the boundary, where a hand-rolled client cannot bypass it.
 * Importing them from here is what keeps every enforcer in agreement, by
 * construction.
 */

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
