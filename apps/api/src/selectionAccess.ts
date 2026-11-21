// The Selection verdict, answered once.
//
// Pure over rows a caller has already loaded — no database, no session, no
// Hono — beside `access.ts` and for the same reason: the public read, the
// single-work read and the media scope must consume one rule rather than each
// spelling out a predicate of its own.
//
// The decision is that a Selection is a **second gate** over its Catalogue's
// works (ADR-0015). A member of the source Catalogue sees every Selection cut
// from it, whatever its status. Everyone else sees one exactly when it is
// public and either has no password or the reader holds a valid grant.
//
// The source Catalogue's **visibility never enters the verdict**. A private
// Catalogue may have a public Selection: that is the feature, not a tolerated
// leak. Its **deletion** does matter, but that is the loader's question — a
// pair with a stamped Catalogue never reaches this predicate. The catalogue
// parameter is therefore deliberately inert; it is here so the unit matrix can
// vary it across every cell and prove no answer moves.
//
// `selectionRefusal` classifies the failed verdict. The public loader folds a
// plain `forbidden` into the same not-found a deleted Selection answers, so a
// private Selection never confirms its own existence; only a protected one
// remains a distinct challenge, because the lock screen has to be able to name
// what it is unlocking.

import type { selections as selectionsTable } from "@arcula/db";

import { isMember, type CatalogueFacts, type Membership } from "./access";
import { ApiError } from "./errors";

/** The Selection row's access-relevant shape. */
export type SelectionFacts = Pick<
  typeof selectionsTable.$inferSelect,
  "catalogueId" | "name" | "isPublic" | "passwordHash"
>;

/**
 * May this viewer read this Selection?
 *
 * `_catalogue` is intentionally unused. The source Catalogue's `isPublic`,
 * `passwordHash` and `userId` must not enter the answer: a Selection has its
 * own audience, and the Catalogue's deletion is enforced by the loader that
 * joins a live parent row. The parameter stays in the signature so the unit
 * matrix can vary it against every case and catch a future "tidy-up" that
 * quietly starts consulting it.
 */
export const canSeeSelection = (
  membership: Membership,
  _catalogue: CatalogueFacts,
  selection: SelectionFacts,
  hasValidGrant = false,
): boolean =>
  isMember(membership) ||
  (selection.isPublic && (selection.passwordHash === null || hasValidGrant));

/**
 * How a Selection the verdict refuses is classified.
 *
 * A Public Selection with a password is a challenge — it names itself so the
 * lock screen can ask for the password — and everything else is the plain
 * refusal for a private one. The name rides in `details`, the envelope's one
 * nested slot: `errorResponse` spreads a detail's keys at the top level, so a
 * bare `{ selectionName }` would land on `error.selectionName`, which no client
 * reads and the lock screen would never see.
 */
export function selectionRefusal(selection: SelectionFacts): ApiError {
  if (selection.isPublic && selection.passwordHash !== null) {
    return new ApiError("password-required", "This selection is protected", {
      details: { selectionName: selection.name },
    });
  }
  return new ApiError("forbidden", "This selection is private");
}
