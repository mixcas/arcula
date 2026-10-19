// The one place the visitor question is answered, as a pure function over
// rows a caller has already loaded: no database, no session, no Hono.
//
// The matrix is the whole product rule (ADR-0003): the collection is the gate,
// a published work is what stands in front of it, and a draft, a deleted work
// and a private collection are one answer to anyone but the owner. Documents
// are not part of that story at all — owner-only, at every status, in every
// collection.
//
// The three viewers are named the way the glossary names them: the **Owner**
// (the session user who owns the collection), a **Visitor** (a signed-in
// somebody else) and **Anonymous** (no session, `null`).

import { describe, expect, it } from "vitest";
import {
  canReadArtworkDocuments,
  canSeeArtwork,
  canSeeCollection,
  isOwner,
} from "../src/access";

const OWNER = "owner-1";
const VISITOR = "visitor-1";
const ANONYMOUS = null;

const collection = (
  overrides: { userId?: string; isPublic?: boolean } = {},
) => ({
  userId: overrides.userId ?? OWNER,
  isPublic: overrides.isPublic ?? true,
});

const artwork = (
  overrides: {
    userId?: string;
    status?: "draft" | "published";
    deletedAt?: Date | null;
  } = {},
) => ({
  userId: overrides.userId ?? OWNER,
  status: overrides.status ?? ("published" as const),
  deletedAt: overrides.deletedAt ?? null,
});

const PUBLISHED_AND_PUBLIC = collection();
const PRIVATE_COLLECTION = collection({ isPublic: false });

const LIVE_PUBLISHED = artwork();
const LIVE_DRAFT = artwork({ status: "draft" });
const DELETED = artwork({ deletedAt: new Date("2026-01-01T00:00:00Z") });

describe("isOwner", () => {
  it("is true only for the session user a row names", () => {
    expect(isOwner(OWNER, { userId: OWNER })).toBe(true);
    expect(isOwner(VISITOR, { userId: OWNER })).toBe(false);
    // Anonymous is not "somebody who is not the owner": it is nobody.
    expect(isOwner(ANONYMOUS, { userId: OWNER })).toBe(false);
  });
});

describe("canSeeCollection", () => {
  it.each([
    // [viewer, collection, expected]
    [OWNER, PRIVATE_COLLECTION, true],
    [OWNER, PUBLISHED_AND_PUBLIC, true],
    [VISITOR, PRIVATE_COLLECTION, false],
    [VISITOR, PUBLISHED_AND_PUBLIC, true],
    [ANONYMOUS, PRIVATE_COLLECTION, false],
    [ANONYMOUS, PUBLISHED_AND_PUBLIC, true],
  ] as const)("%s on %j", (viewer, target, expected) => {
    expect(canSeeCollection(viewer, target)).toBe(expected);
  });
});

describe("canSeeArtwork", () => {
  it("shows the owner every work of their collection", () => {
    // Status and tombstones are the visitor's question, not the owner's: an
    // owner editing a draft, or restoring a deleted work, must still read it.
    for (const row of [LIVE_PUBLISHED, LIVE_DRAFT, DELETED]) {
      for (const coll of [PUBLISHED_AND_PUBLIC, PRIVATE_COLLECTION]) {
        expect(canSeeArtwork(OWNER, coll, row)).toBe(true);
      }
    }
  });

  it("shows a visitor and an anonymous reader a published, live work of a public collection", () => {
    for (const viewer of [VISITOR, ANONYMOUS]) {
      expect(canSeeArtwork(viewer, PUBLISHED_AND_PUBLIC, LIVE_PUBLISHED)).toBe(
        true,
      );
    }
  });

  it.each([
    ["a draft", PUBLISHED_AND_PUBLIC, LIVE_DRAFT],
    ["a deleted work", PUBLISHED_AND_PUBLIC, DELETED],
    [
      "a published work of a private collection",
      PRIVATE_COLLECTION,
      LIVE_PUBLISHED,
    ],
    ["a draft of a private collection", PRIVATE_COLLECTION, LIVE_DRAFT],
    ["a deleted work of a private collection", PRIVATE_COLLECTION, DELETED],
  ] as const)(
    "hides %s from a visitor and an anonymous reader",
    (_label, coll, row) => {
      // The case this replaces — a published work readable by direct link
      // inside a private collection — is the third row above.
      expect(canSeeArtwork(VISITOR, coll, row)).toBe(false);
      expect(canSeeArtwork(ANONYMOUS, coll, row)).toBe(false);
    },
  );
});

describe("canReadArtworkDocuments", () => {
  it("admits the owner at every status and in every collection", () => {
    for (const row of [LIVE_PUBLISHED, LIVE_DRAFT, DELETED]) {
      expect(canReadArtworkDocuments(OWNER, row)).toBe(true);
    }
  });

  it("refuses a visitor and an anonymous reader, whatever the work", () => {
    // Documents are never public: the collection's gate does not reach them,
    // and a published work in a public collection is the case most likely to
    // be mistaken for one where they are.
    for (const row of [LIVE_PUBLISHED, LIVE_DRAFT, DELETED]) {
      expect(canReadArtworkDocuments(VISITOR, row)).toBe(false);
      expect(canReadArtworkDocuments(ANONYMOUS, row)).toBe(false);
    }
  });
});
