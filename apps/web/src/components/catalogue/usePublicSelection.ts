/**
 * The public Selection address's data layer.
 *
 * It is `usePublicCatalogue.ts` with the noun changed, and deliberately so:
 * the union, the reload mechanism and the two failure folds are the same
 * shapes, because the page's render is the same switch. What differs is the
 * decision the read makes and the order it makes it in.
 *
 * ## Selection first, works second
 *
 * The two reads are sequential, and not for latency: the works are requested
 * only once the Selection is known to be readable by this caller. A private
 * Selection's name and description must never reach an unauthenticated client,
 * and the API denies that read outright — so the denial happens before the
 * second round trip is ever issued. A Protected one is the same shape: its read
 * is refused until the reader holds the Selection's grant, and the lock screen
 * answers it by re-running this very load with the cookie now set.
 *
 * The works read carries the Selection's grant cookie automatically — same
 * origin, `path=/api/v1` — and answers the one ordered envelope every audience
 * gets. There is **no status filter**: a Draft is the point of the feature, so
 * the list is passed through exactly as it arrived. The server orders by
 * `position, artworkId`; sorting here would destroy the curator's order, which
 * is the content.
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
 * ## The single-work view
 *
 * A work's own address reads the Selection and then the one work — not the
 * works list. The single-work route is tournament-shaped: it answers a work
 * only when the Selection curates it, and folds every refusal into one 404, so
 * there is nothing to prove client-side. The lock is still the Selection read's
 * answer, which is why it necessarily comes first.
 */

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { ApiRequestError } from "@/services/api";
import { selectionService } from "@/services/selectionService";
import type { Artwork, SelectionPublicRead } from "@arcula/shared";

import type { PublicStatus } from "./usePublicCatalogue";

export type PublicSelectionState<T> =
  | { status: "locked"; selectionName?: string }
  | { status: Exclude<PublicStatus, "ready" | "locked"> }
  | { status: "ready"; value: T };

export interface PublicSelectionData {
  /** The Selection document: its own name, description and presentation. */
  selection: SelectionPublicRead;
  /** Its works, in the curator's order, Drafts included. */
  artworks: Artwork[];
}

export interface PublicSelectionArtworkData {
  /** The Selection the work belongs to — the page's subject and credit line. */
  selection: SelectionPublicRead;
  /** The one work, at the Selection's own artwork address. */
  artwork: Artwork;
}

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
 * Fold the public read and its works into a state.
 *
 * A document is ready whatever its `isPublic` says: the API answers a private
 * Selection only to a member, and a member's preview should render the truth.
 * `null` is the one absence — missing, deleted, or hidden by the API — and it
 * is the visitor's not-found either way. The works are carried untouched; see
 * the header for why that is a rule rather than an omission.
 */
export const publicSelectionState = (
  document: SelectionPublicRead | null,
  artworks: Artwork[],
): PublicSelectionState<PublicSelectionData> =>
  document === null
    ? { status: "notFound" }
    : { status: "ready", value: { selection: document, artworks } };

/**
 * Fold the Selection and one work into a state.
 *
 * There is no parenthood check to add: unlike the Catalogue's flat artwork
 * read, the Selection's single-work route refuses a work that is not curated.
 * Both `null`s are the same not-found — a work outside the Selection, a work
 * deleted in its Catalogue, a private Selection and a stamped one are one
 * answer, which is what keeps the address from confirming what is hidden.
 */
export const publicSelectionArtworkState = (
  document: SelectionPublicRead | null,
  artwork: Artwork | null,
): PublicSelectionState<PublicSelectionArtworkData> =>
  document === null || artwork === null
    ? { status: "notFound" }
    : { status: "ready", value: { selection: document, artwork } };

export interface PublicSelectionView<T> {
  state: PublicSelectionState<T>;
  /** Re-run the ordinary load — what the lock screen calls on success. */
  reload: () => void;
}

const loadSelection = async (
  selectionId: string,
): Promise<PublicSelectionState<PublicSelectionData>> => {
  const selection = await selectionService.getPublicSelection(selectionId);
  if (selection === null) {
    return { status: "notFound" };
  }
  // Only now is a second round trip owed; a refused Selection never issues it.
  return publicSelectionState(
    selection,
    await selectionService.getWorks(selectionId),
  );
};

/** The public state of one Selection, and a way to run the load again. */
export const usePublicSelection = (
  selectionId: string,
): PublicSelectionView<PublicSelectionData> => {
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

const loadSelectionArtwork = async (
  selectionId: string,
  artworkId: string,
): Promise<PublicSelectionState<PublicSelectionArtworkData>> => {
  const selection = await selectionService.getPublicSelection(selectionId);
  if (selection === null) {
    return { status: "notFound" };
  }
  return publicSelectionArtworkState(
    selection,
    await selectionService.getArtwork(selectionId, artworkId),
  );
};

/**
 * The public state of one work under a Selection's address.
 *
 * Only the Selection and the single work are fetched — not the works list.
 * Nothing on the artwork view needs a neighbour, and the single-work read's 404
 * already folds "not in this Selection" for the server to enforce.
 */
export const usePublicSelectionArtwork = (
  selectionId: string,
  artworkId: string,
): PublicSelectionView<PublicSelectionArtworkData> => {
  const [state, setState] = useState<
    PublicSelectionState<PublicSelectionArtworkData>
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!selectionId || !artworkId) {
      return;
    }
    let cancelled = false;
    const apply = (next: PublicSelectionState<PublicSelectionArtworkData>) => {
      if (!cancelled) {
        setState(next);
      }
    };
    void loadSelectionArtwork(selectionId, artworkId).then(
      apply,
      (error: unknown) => {
        apply(publicSelectionFailure(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectionId, artworkId, attempt]);

  return {
    state: selectionId && artworkId ? state : { status: "invalid" },
    reload,
  };
};
