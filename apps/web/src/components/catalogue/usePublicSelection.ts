/**
 * The public Selection address's data layer.
 *
 * It is `usePublicCatalogue.ts` with the noun changed, and deliberately so:
 * the union, the reload mechanism and the two failure folds are the same
 * shapes, because the page's render is the same switch. What differs is the
 * decision the read makes.
 *
 * ## A private Selection is not rejected here
 *
 * The API decides who may read the address. A member previewing their own
 * Private Selection is a legitimate caller, and its answer is a document, not
 * a refusal — so this layer must not add a client-side `isPublic` gate the way
 * the Catalogue's fold does. A visitor's private Selection never reaches this
 * layer as a document at all: the API folds it to the same not-found a deleted
 * one answers.
 *
 * ## The lock screen is one path to ready
 *
 * A `password-required` refusal is folded to `locked` with the Selection's name
 * parsed out of `error.details`. The lock screen's attempt sets the grant
 * cookie and calls `reload`, which re-runs this very load. There is no second
 * read behind the challenge.
 *
 * The works read arrives in the curation slice (#352); this slice reads the
 * Selection alone, so the page can render its subject and an empty stage.
 */

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { ApiRequestError } from "@/services/api";
import { selectionService } from "@/services/selectionService";
import type { SelectionPublicRead } from "@arcula/shared";

import type { PublicStatus } from "./usePublicCatalogue";

export type PublicSelectionState<T> =
  | { status: "locked"; selectionName?: string }
  | { status: Exclude<PublicStatus, "ready" | "locked"> }
  | { status: "ready"; value: T };

export type PublicSelectionData = SelectionPublicRead;

/**
 * What a `password-required` refusal carries: the name the lock screen puts on
 * screen. Parsed rather than read loosely, so a reshaped detail leaves the
 * screen with its generic line instead of the string "undefined".
 */
const lockDetails = z.object({ selectionName: z.string().min(1) });

/**
 * A refused read, or a failure that is not a refusal.
 *
 * A 403 is the API doing its job. `password-required` is a challenge the lock
 * screen can pass, and it names the Selection; a plain `forbidden` is the
 * visitor's private state. Everything else — including a dropped connection,
 * which carries no status — is an error.
 */
export const publicSelectionFailure = (
  error: unknown,
): PublicSelectionState<never> => {
  if (!(error instanceof ApiRequestError) || error.status !== 403) {
    return { status: "error" };
  }
  if (error.code !== "password-required") {
    return { status: "private" };
  }
  const details = lockDetails.safeParse(error.details);
  return details.success
    ? { status: "locked", selectionName: details.data.selectionName }
    : { status: "locked" };
};

/**
 * Fold the public read into a state.
 *
 * A document is ready whatever its `isPublic` says: the API answers a private
 * Selection only to a member, and a member's preview should render the truth.
 * `null` is the one absence — missing, deleted, or hidden by the API — and it
 * is the visitor's not-found either way.
 */
export const publicSelectionState = (
  document: SelectionPublicRead | null,
): PublicSelectionState<PublicSelectionData> =>
  document === null
    ? { status: "notFound" }
    : { status: "ready", value: document };

export interface PublicSelectionView {
  state: PublicSelectionState<PublicSelectionData>;
  /** Re-run the ordinary load — what the lock screen calls on success. */
  reload: () => void;
}

const loadSelection = async (
  selectionId: string,
): Promise<PublicSelectionState<PublicSelectionData>> =>
  publicSelectionState(await selectionService.getPublicSelection(selectionId));

/** The public state of one Selection, and a way to run the load again. */
export const usePublicSelection = (
  selectionId: string,
): PublicSelectionView => {
  const [state, setState] = useState<PublicSelectionState<PublicSelectionData>>(
    { status: "loading" },
  );
  const [attempt, setAttempt] = useState(0);

  // Back to `loading` here rather than in the effect: a reload a visitor asked
  // for is a state change they should see immediately, and React asks that an
  // effect not set state synchronously.
  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!selectionId) {
      return;
    }
    // Without this, navigating between two Selections can land the first
    // fetch's result after the second one has already rendered.
    let cancelled = false;
    const apply = (next: PublicSelectionState<PublicSelectionData>) => {
      if (!cancelled) {
        setState(next);
      }
    };
    void loadSelection(selectionId).then(apply, (error: unknown) => {
      apply(publicSelectionFailure(error));
    });
    return () => {
      cancelled = true;
    };
  }, [selectionId, attempt]);

  return {
    state: selectionId ? state : { status: "invalid" },
    reload,
  };
};
