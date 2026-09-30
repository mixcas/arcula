import { describe, expect, it } from "vitest";
import { FirebaseError } from "firebase/app";

import {
  publicArtworkState,
  publicCollectionState,
  publicFailure,
} from "@/components/collection/usePublicCollection";
import type { Artwork, Collection } from "@/types";

const COLLECTION_ID = "collection-1";

const collection = (overrides: Partial<Collection> = {}): Collection => ({
  id: COLLECTION_ID,
  name: "Flores Solares",
  userId: "owner-1",
  isPublic: true,
  ...overrides,
});

const artwork = (overrides: Partial<Artwork> = {}): Artwork => ({
  id: "artwork-1",
  userId: "owner-1",
  collectionId: COLLECTION_ID,
  title: "Estudio en rojo",
  artistName: "María López",
  isPublic: true,
  photos: [],
  documents: [],
  ...overrides,
});

const denied = (): FirebaseError =>
  new FirebaseError(
    "permission-denied",
    "Missing or insufficient permissions.",
  );

describe("publicFailure", () => {
  it("maps permission-denied to `private`, and nothing else", () => {
    // A denied read is the rules doing their job, not a malfunction. Reporting
    // it as an error both reads badly to a visitor and invites a retry that
    // cannot succeed.
    expect(publicFailure(denied())).toEqual({ status: "private" });
  });

  it("maps every other failure to `error`", () => {
    for (const error of [
      new FirebaseError("unavailable", "The service is unavailable."),
      new FirebaseError("unauthenticated", "no auth"),
      new TypeError("undefined is not a function"),
      "a bare string",
      undefined,
    ]) {
      expect(publicFailure(error)).toEqual({ status: "error" });
    }
  });
});

describe("publicCollectionState", () => {
  it("is `notFound` when the collection read returned nothing", () => {
    expect(publicCollectionState(null, [])).toEqual({ status: "notFound" });
  });

  it("is `private` for a readable but unpublished collection", () => {
    // Not `notFound`. The collection plainly exists, and an owner previewing
    // their own private collection lands here too — the rules let them read it.
    // They are told it is private, which is true.
    expect(publicCollectionState(collection({ isPublic: false }), [])).toEqual({
      status: "private",
    });
  });

  it("is `private` for isPublic absent, not merely false", () => {
    // A collection written before the field existed reads as private rather
    // than as an error, which is the safe direction.
    expect(
      publicCollectionState(collection({ isPublic: undefined }), []),
    ).toEqual({ status: "private" });
  });

  it("is `ready` with the artworks for a published collection", () => {
    const works = [artwork({ id: "b" }), artwork({ id: "a" })];
    const state = publicCollectionState(collection(), works);
    expect(state.status).toBe("ready");
    // Order is passed through, not re-sorted: the caller sorts, because the
    // sort's reason (avoiding a composite index) belongs beside the query.
    if (state.status === "ready") {
      expect(state.value.artworks.map((a) => a.id)).toEqual(["b", "a"]);
    }
  });

  it("coalesces a null artwork list rather than leaking the sequencing", () => {
    // `artworks: null` means the second read never happened. The ready branch
    // still has to produce the same shape, or every caller would have to handle
    // a third possibility.
    const state = publicCollectionState(collection(), null);
    expect(state).toEqual({
      status: "ready",
      value: { collection: collection(), artworks: [] },
    });
  });
});

describe("publicArtworkState", () => {
  it("is `ready` with the single artwork", () => {
    const work = artwork();
    expect(publicArtworkState(collection(), work, COLLECTION_ID)).toEqual({
      status: "ready",
      value: { collection: collection(), artwork: work },
    });
  });

  it("is `notFound` when either read returned nothing", () => {
    expect(publicArtworkState(null, artwork(), COLLECTION_ID)).toEqual({
      status: "notFound",
    });
    expect(publicArtworkState(collection(), null, COLLECTION_ID)).toEqual({
      status: "notFound",
    });
  });

  it("is `private` for an unpublished collection, whatever the artwork is", () => {
    // The collection read is the gate, so its answer wins.
    expect(
      publicArtworkState(
        collection({ isPublic: false }),
        artwork(),
        COLLECTION_ID,
      ),
    ).toEqual({ status: "private" });
  });

  it("is `notFound` for a public artwork from a *different* collection", () => {
    // Not redundant with the rules. `firestore.rules` admits a public,
    // un-deleted artwork by its own id whatever collection it is in — that is
    // deliberate, so an owner can keep one work public inside a private
    // collection. Nothing server-side stops a work rendering on another
    // collection's URL, so this comparison is the whole check.
    expect(
      publicArtworkState(
        collection(),
        artwork({ collectionId: "some-other-collection" }),
        COLLECTION_ID,
      ),
    ).toEqual({ status: "notFound" });
  });

  it("does not require the artwork to be public itself", () => {
    // The rules already refuse a private or soft-deleted work, so by the time a
    // document arrives here it passed that gate. Asserted because it looks like
    // a gap: re-checking `isPublic` here would be defence in depth with no
    // reachable failure, and the flag is the owner's per-work switch.
    const state = publicArtworkState(
      collection(),
      artwork({ isPublic: false }),
      COLLECTION_ID,
    );
    expect(state.status).toBe("ready");
  });
});
