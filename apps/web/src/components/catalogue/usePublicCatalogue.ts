/**
 * The public views' data layer.
 *
 * ## Why the state is a union, and why half of it is pure
 *
 * The page this replaces tracked six overlapping booleans (`loading`, `error`,
 * `denied`, the catalogue, the artworks, the lock screen) and picked a
 * branch out of them in the render body, where two of them could be true at
 * once and the ordering of the conditionals was doing real work. A refusal in
 * particular only reached the right screen because the `!catalogue` branch
 * happened to be skipped for it.
 *
 * A single discriminated union removes the ordering problem: exactly one status
 * holds, and the render is a switch. But a union is only worth having if the
 * decisions can be tested, and a hook that both fetches and decides can only be
 * tested against a live API. So the *decisions* are pure functions over
 * already-fetched values — `publicCatalogueState`, `publicArtworkState`,
 * `publicFailure` — and the hooks are thin wrappers that call the services and
 * hand the results over.
 *
 * ## The sequencing that matters
 *
 * The catalogue is read first, and the artworks are requested only once it is
 * known to be published. That is not an optimisation: a private catalogue's
 * name and description must never reach an unauthenticated client, and the
 * API denies that read outright — so the denial happens before the second
 * round trip is ever issued. A **Protected** catalogue is the same shape: its
 * read is refused until the reader has the password, and the lock screen the
 * refusal opens is answered by re-running this very load with the grant cookie
 * now set. There is one path to ready.
 */

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { artworkService } from "@/services/artworkService";
import { catalogueService } from "@/services/catalogueService";
import { ApiRequestError } from "@/services/api";
import type { Artwork, Catalogue } from "@arcula/shared";

/** The only status a page ever renders. */
export type PublicStatus =
  "invalid" | "loading" | "error" | "private" | "locked" | "notFound" | "ready";

export type PublicState<T> =
  | { status: "locked"; catalogueName?: string }
  | { status: Exclude<PublicStatus, "ready" | "locked"> }
  | { status: "ready"; value: T };

export interface PublicCatalogueData {
  catalogue: Catalogue;
  artworks: Artwork[];
}

export interface PublicArtworkData {
  catalogue: Catalogue;
  artwork: Artwork;
}

/**
 * What a `password-required` refusal carries: the name the lock screen puts on
 * screen. Parsed rather than read loosely, so a reshaped detail leaves the
 * screen with its generic line instead of the string "undefined".
 */
const lockDetails = z.object({ collectionName: z.string().min(1) });

/**
 * A read that was refused, or that failed for any other reason.
 *
 * A 403 is the API doing its job, not a malfunction, so it gets its own state
 * rather than an error message: telling a visitor a public page "failed" when
 * the real answer is "this catalogue is not published" both reads badly and
 * invites a retry that cannot succeed. Everything else — including a dropped
 * connection, which carries no status at all — is an error.
 *
 * The two 403s are different states. `password-required` is a **challenge**:
 * the catalogue is public and Protected, the reader holds no grant, and the
 * lock screen can pass it — so it names the catalogue and asks. A plain
 * `forbidden` is the refusal a private catalogue makes, and stays `private`.
 */
export const publicFailure = (error: unknown): PublicState<never> => {
  if (!(error instanceof ApiRequestError) || error.status !== 403) {
    return { status: "error" };
  }
  if (error.code !== "password-required") {
    return { status: "private" };
  }
  const details = lockDetails.safeParse(error.details);
  return details.success
    ? { status: "locked", catalogueName: details.data.collectionName }
    : { status: "locked" };
};

/**
 * Fold a published-catalogue read into a state.
 *
 * `isPublic !== true` is the `private` state rather than `notFound`, for two
 * reasons. It is the honest description — a catalogue that is not published has
 * nothing to show a visitor — and it is where an owner previewing their *own*
 * private catalogue lands, since the API lets them read it. They are told it
 * is private, which is true, rather than shown a "not available" page for a
 * document that plainly exists.
 *
 * `artworks` is null only when the catalogue was not published, in which case
 * the second read never happened; the ready branch coalesces it so the shape
 * does not leak the sequencing.
 */
export const publicCatalogueState = (
  catalogue: Catalogue | null,
  artworks: Artwork[] | null,
): PublicState<PublicCatalogueData> => {
  if (catalogue === null) {
    return { status: "notFound" };
  }
  if (catalogue.isPublic !== true) {
    return { status: "private" };
  }
  return {
    status: "ready",
    value: { catalogue, artworks: artworks ?? [] },
  };
};

/**
 * Fold a single-artwork read into a state.
 *
 * The parent check is not redundant. The API serves a public, un-deleted
 * artwork by its own id *whatever catalogue it is in* — deliberate, so an
 * owner can keep one work public inside a private catalogue — which means the
 * server cannot enforce "this work belongs to the catalogue in the address
 * bar". Without this comparison a public work would render on another
 * catalogue's URL.
 *
 * The artwork read has no `private` state: a refused read here means *this
 * artwork* is not public, not that the catalogue is, and the caller maps that
 * to `notFound` — which is the right thing to tell someone about a link to a
 * work that is not published.
 */
export const publicArtworkState = (
  catalogue: Catalogue | null,
  artwork: Artwork | null,
  catalogueId: string,
): PublicState<PublicArtworkData> => {
  if (catalogue === null || artwork === null) {
    return { status: "notFound" };
  }
  if (catalogue.isPublic !== true) {
    return { status: "private" };
  }
  if (artwork.collectionId !== catalogueId) {
    return { status: "notFound" };
  }
  return { status: "ready", value: { catalogue, artwork } };
};

/**
 * The published artworks of a catalogue, in the order the page shows them.
 *
 * Sorted by title on the client because the list route answers in no
 * particular order, and a catalogue's public page should read the same on
 * every visit. `title` is required on `Artwork`, so the comparison is always
 * safe.
 */
const byTitle = (artworks: Artwork[]): Artwork[] =>
  [...artworks].sort((a, b) => a.title.localeCompare(b.title));

/**
 * Read a published catalogue and its public artworks.
 *
 * Sequential on purpose, and not for latency: the artworks are requested only
 * once the catalogue is known to be published, so a private catalogue's name
 * and description never reach an unauthenticated client. The API denies that
 * first read outright, so the denial happens before the second round trip is
 * ever issued.
 *
 * Throws whatever the services throw, so the caller can map it with
 * `publicFailure` — the catalogue read is the one whose status says
 * something (403 is a private catalogue; 404 arrives as `null`, not a throw).
 */
const loadCatalogue = async (
  catalogueId: string,
): Promise<PublicState<PublicCatalogueData>> => {
  const catalogue = await catalogueService.getCatalogue(catalogueId);
  if (catalogue === null) {
    return { status: "notFound" };
  }
  if (catalogue.isPublic !== true) {
    return { status: "private" };
  }
  // One list route for both callers: the session decides what it returns —
  // every live work for the owner, the public ones for a visitor.
  const artworks = await artworkService.getCatalogueArtworks(catalogueId);
  return publicCatalogueState(catalogue, byTitle(artworks));
};

/**
 * What both public views' hooks answer: exactly one status holds, and the
 * `reload` the lock screen calls on success. One interface for the two
 * because the lock screen, the render and the page's reload are the same
 * shape whichever document was locked.
 */
export interface PublicView<T> {
  state: PublicState<T>;
  /**
   * Re-run the ordinary load — what the lock screen calls on success, with the
   * grant cookie now set. It is the same load a visitor's page runs, so there
   * is one path to ready and the sequencing is unchanged.
   */
  reload: () => void;
}

/** The public state of a whole catalogue, and a way to run the load again. */
export const usePublicCatalogue = (
  catalogueId: string,
): PublicView<PublicCatalogueData> => {
  const [state, setState] = useState<PublicState<PublicCatalogueData>>({
    status: "loading",
  });
  // A reload is a new attempt, not a new catalogue: the effect below re-runs
  // against the same id and starts from `loading` again.
  const [attempt, setAttempt] = useState(0);
  // Back to `loading` here rather than in the effect: a reload a visitor asked
  // for is a state change they should see immediately, and React asks that an
  // effect not set state synchronously.
  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!catalogueId) {
      return;
    }
    // Without this, navigating between two catalogues can land the first
    // fetch's result after the second one has already rendered.
    let cancelled = false;
    const apply = (next: PublicState<PublicCatalogueData>) => {
      if (!cancelled) {
        setState(next);
      }
    };
    void loadCatalogue(catalogueId).then(apply, (error: unknown) => {
      apply(publicFailure(error));
    });
    return () => {
      cancelled = true;
    };
  }, [catalogueId, attempt]);

  // A missing id is decided from the argument rather than stored, so there is no
  // state to set and no extra render to schedule for a case the route has
  // already decided.
  return {
    state: catalogueId ? state : { status: "invalid" },
    reload,
  };
};

/**
 * Read one published artwork together with its published catalogue.
 *
 * The 404s on the artwork read are the contract, not failures: for a visitor a
 * private work, a deleted work and an absent work all answer "not here" —
 * saying which was refused would be a disclosure — and the service folds that
 * to `null`, which `publicArtworkState` turns into `notFound`. A transport
 * failure still throws, because reporting "this artwork does not exist" for a
 * dropped connection is a claim the app cannot support, and it costs the
 * visitor a retry that would have worked.
 */
const loadArtwork = async (
  catalogueId: string,
  artworkId: string,
): Promise<PublicState<PublicArtworkData>> => {
  const catalogue = await catalogueService.getCatalogue(catalogueId);
  if (catalogue === null) {
    return { status: "notFound" };
  }
  if (catalogue.isPublic !== true) {
    return { status: "private" };
  }
  const artwork = await artworkService.getArtwork(catalogueId, artworkId);
  return publicArtworkState(catalogue, artwork, catalogueId);
};

/**
 * The public state of one artwork.
 *
 * Only the single work is fetched, not the catalogue's list. That saves a
 * round trip, and nothing on the artwork view needs a neighbour: it offers a
 * link back to the catalogue and nothing else. A skin that did want neighbours
 * would need the list here, which is a deliberate cost, not an oversight.
 */
export const usePublicArtwork = (
  catalogueId: string,
  artworkId: string,
): PublicView<PublicArtworkData> => {
  const [state, setState] = useState<PublicState<PublicArtworkData>>({
    status: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  // Back to `loading` here rather than in the effect: a reload a visitor asked
  // for is a state change they should see immediately, and React asks that an
  // effect not set state synchronously.
  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!catalogueId || !artworkId) {
      return;
    }
    let cancelled = false;
    const apply = (next: PublicState<PublicArtworkData>) => {
      if (!cancelled) {
        setState(next);
      }
    };
    void loadArtwork(catalogueId, artworkId).then(apply, (error: unknown) => {
      apply(publicFailure(error));
    });
    return () => {
      cancelled = true;
    };
  }, [catalogueId, artworkId, attempt]);

  return {
    state: catalogueId && artworkId ? state : { status: "invalid" },
    reload,
  };
};
