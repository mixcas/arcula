/**
 * What the photo pipeline asks when a Selection's media object is refused.
 *
 * It mirrors `cataloguePdfAccess.ts`, with the Selection's own read as the
 * question: the media proxy answers a missing or unauthorised object with
 * `404`, so a refusal is not immediately a placeholder. The Selection is read
 * again, and that read decides whether the export may continue:
 *
 * - still readable → the object is genuinely missing: one placeholder page;
 * - `403 password-required` → the Selection's grant died: re-lock and restart;
 * - any other `403` → the Selection became private: the private state;
 * - `404` → the Selection (or its Catalogue) is gone: the notFound state;
 * - any other failure (network, `500`) → a broken image, **not** lost access.
 *
 * The photo URLs the export fetches are the works read's own and are passed
 * through verbatim: they carry the `selection` scope that admits a Draft's
 * bytes, and stripping it would turn a readable Draft into a placeholder.
 */

import { selectionService } from "@/services/selectionService";
import { publicSelectionFailure } from "@/components/catalogue/usePublicSelection";
import type { SelectionPublicRead } from "@arcula/shared";

import type { AccessOutcome } from "./cataloguePdfAccess";

/** A successful re-read: the refusal was the object, not the access. */
export const selectionReadOutcome = (
  selection: SelectionPublicRead | null,
): AccessOutcome =>
  selection === null ? { status: "notFound" } : { status: "continue" };

/** A failed re-read, mapped the way the public Selection pages map theirs. */
export const selectionAccessRefusalOutcome = (
  error: unknown,
): AccessOutcome => {
  const failure = publicSelectionFailure(error);
  if (failure.status === "locked") {
    return failure;
  }
  if (failure.status === "private") {
    return { status: "private" };
  }
  // `error` — a `500`, a dropped connection, a malformed body — is a broken
  // image. Retrying the export is the reader's next action, not a state change.
  return { status: "continue" };
};

/**
 * Read the Selection again after a refused photo.
 *
 * The same question the public Selection pages ask, through the same service,
 * so a grant that is still valid, one that expired between pages and a
 * Selection that turned private all answer exactly as a fresh visit would.
 */
export async function recheckSelectionAccess(
  selectionId: string,
): Promise<AccessOutcome> {
  try {
    return selectionReadOutcome(
      await selectionService.getPublicSelection(selectionId),
    );
  } catch (error) {
    return selectionAccessRefusalOutcome(error);
  }
}
