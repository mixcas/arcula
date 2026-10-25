/**
 * What the photo pipeline asks when a media object is refused.
 *
 * The media proxy answers a missing or unauthorised object with `404`, not
 * `403 password-required`: only the Collection read carries that code. So a
 * refused photo is not immediately a placeholder — the Collection is read
 * again, and that read decides whether the export may continue at all:
 *
 * - still readable → the object is genuinely missing: one placeholder page;
 * - `403 password-required` → the Access grant died: re-lock and restart;
 * - any other `403` → the Collection became private: the private state;
 * - `404` → the Collection is gone: the notFound state;
 * - any other failure (network, `500`) → a broken image, **not** lost access.
 *   A dropped connection says nothing about permission, and turning it into a
 *   state change would throw away an export that a retry would complete.
 *
 * The first four answers replace the viewer's state, so no document full of
 * placeholders is ever produced for a collection the reader can no longer see.
 */

import { collectionService } from "@/services/collectionService";
import { publicFailure } from "@/components/collection/usePublicCollection";
import type { Collection } from "@arcula/shared";

/** The verdict of the re-read: carry on, or stop in one of the viewer's states. */
export type AccessOutcome =
  | { status: "continue" }
  | { status: "locked"; collectionName?: string }
  | { status: "private" }
  | { status: "notFound" };

/** The outcome that stops an export: every one of them is a viewer state. */
export type AccessLost = Exclude<AccessOutcome, { status: "continue" }>;

/**
 * Thrown through the export run when the re-read says the export must stop.
 *
 * It carries the state the viewer switches to, so the page never re-derives
 * the access decision the pipeline already made.
 */
export class CollectionPdfAccessError extends Error {
  constructor(public readonly state: AccessLost) {
    super("the collection can no longer be read");
    this.name = "CollectionPdfAccessError";
  }
}

/** A successful re-read: the refusal was the object, not the access. */
export const collectionReadOutcome = (
  collection: Collection | null,
): AccessOutcome =>
  collection === null ? { status: "notFound" } : { status: "continue" };

/** A failed re-read, mapped the way the public pages map their own refusals. */
export const accessRefusalOutcome = (error: unknown): AccessOutcome => {
  const failure = publicFailure(error);
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
 * Read the Collection again after a refused photo.
 *
 * It asks the same question the public pages ask, through the same service, so
 * a grant that is still valid, one that expired between pages and a collection
 * that turned private all answer exactly as they would on a fresh visit.
 */
export async function recheckCollectionAccess(
  collectionId: string,
): Promise<AccessOutcome> {
  try {
    return collectionReadOutcome(
      await collectionService.getCollection(collectionId),
    );
  } catch (error) {
    return accessRefusalOutcome(error);
  }
}
