/**
 * The caps and accepted-type maps, shared by every side that enforces them.
 *
 * Today the web client enforces these in the Add/Edit forms — a file that
 * fails a cap is rejected before it is decoded or uploaded — and the security
 * rules enforce the same ceilings on upload (the tests pin both directions, so
 * the two cannot drift). The API will enforce them at the boundary it alone
 * can police (a hand-rolled client can bypass the form); importing them from
 * here is what keeps every enforcer in agreement, by construction.
 */

/** Hard cap on images per artwork. Enforced in the form, not by the rules. */
export const MAX_ARTWORK_PHOTOS = 10;

/**
 * Per-file size cap.
 *
 * Must stay in step with the same constant in `storage.rules`. The rule reads
 * `size <= 10 * 1024 * 1024`, so this is a ceiling the client may hit exactly
 * rather than one the server will reject a byte under.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Image types the form accepts. Mirrored in the Dropzone `accept` map. */
export const ACCEPTED_IMAGE_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

/** Hard cap on documents per artwork. Enforced in the form, not by the rules. */
export const MAX_ARTWORK_DOCUMENTS = 10;

/**
 * Per-file size cap for a document.
 *
 * Deliberately larger than `MAX_IMAGE_BYTES`. A scanned catalogue raisonné or a
 * high-resolution condition report is a normal thing to attach to a work and is
 * routinely larger than a photograph, and 10 MiB would reject it in the form
 * with no way to proceed.
 *
 * Must stay in step with `acceptableDocumentUpload` in `storage.rules`. The rule
 * reads `size <= 25 * 1024 * 1024`, so this is a ceiling the client may hit
 * exactly rather than one the server rejects a byte under.
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * The types the form accepts, for the Dropzone `accept` map.
 *
 * Images plus PDF, and nothing else. The narrower this list is, the less the
 * rules have to allow and the fewer things a download URL can hand a browser to
 * render — SVG and HTML are the two that matter here, because both execute in
 * the storage origin when navigated to directly, and neither appears below.
 *
 * That is a real control, not a complete one: `contentType` is supplied by the
 * client and is forgeable, so what the rules can actually bind the declared type
 * to is the filename. The extension allowlist in `storage.rules` is that check.
 */
export const ACCEPTED_DOCUMENT_TYPES: Record<string, string[]> = {
  ...ACCEPTED_IMAGE_TYPES,
  "application/pdf": [".pdf"],
};
