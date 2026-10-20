// The one place the access question is answered, as a pure function over rows
// a caller has already loaded: no database, no session, no Hono.
//
// Two matrices meet here. Membership decides the inside of a collection: the
// owner and every collaborator see the whole collection, drafts and deleted
// works included, and its documents. The visitor rule still decides the
// outside: a published, live work of a public collection, whoever the reader
// is. Documents are inside-only.
//
// Three viewers, named the way the glossary names them: the **Owner** (the
// session user a collection's `userId` names), a **Collaborator** (an account
// with a membership row), and a **Visitor** (anyone else). A Visitor is the
// same access fact signed in or out — `null` is its no-session case — because
// the visitor rule does not read the session.

import { describe, expect, it } from "vitest";
import {
  canReadArtworkDocuments,
  canSeeArtwork,
  canSeeCollection,
  membershipOf,
  type Membership,
} from "../src/access";

const OWNER = "owner-1";
const COLLABORATOR = "collaborator-1";
const VISITOR = "visitor-1";
const ANONYMOUS = null;

const OWNER_MEMBERSHIP: Membership = "owner";
const COLLABORATOR_MEMBERSHIP: Membership = "collaborator";
/** A visitor and an anonymous reader are the same membership: nobody. */
const NOBODY: Membership = null;

const collection = (
  overrides: { userId?: string; isPublic?: boolean } = {},
) => ({
  userId: overrides.userId ?? OWNER,
  isPublic: overrides.isPublic ?? true,
});

const collaboratorRow = (userId: string) => ({ userId });

const artwork = (
  overrides: {
    status?: "draft" | "published";
    deletedAt?: Date | null;
  } = {},
) => ({
  status: overrides.status ?? ("published" as const),
  deletedAt: overrides.deletedAt ?? null,
});

const PUBLISHED_AND_PUBLIC = collection();
const PRIVATE_COLLECTION = collection({ isPublic: false });

const LIVE_PUBLISHED = artwork();
const LIVE_DRAFT = artwork({ status: "draft" });
const DELETED = artwork({ deletedAt: new Date("2026-01-01T00:00:00Z") });

describe("membershipOf", () => {
  it("reads the owner off the collection's userId", () => {
    expect(
      membershipOf(OWNER, PUBLISHED_AND_PUBLIC, collaboratorRow(COLLABORATOR)),
    ).toBe("owner");
    // The owner is the column, never a collaborator row: a stray row for the
    // owner does not change the answer.
    expect(
      membershipOf(OWNER, PUBLISHED_AND_PUBLIC, collaboratorRow(OWNER)),
    ).toBe("owner");
  });

  it("reads a collaborator off their own membership row", () => {
    expect(
      membershipOf(
        COLLABORATOR,
        PUBLISHED_AND_PUBLIC,
        collaboratorRow(COLLABORATOR),
      ),
    ).toBe("collaborator");
  });

  it("is nobody for a signed-in stranger or an anonymous reader", () => {
    expect(membershipOf(VISITOR, PUBLISHED_AND_PUBLIC, null)).toBe(null);
    expect(membershipOf(ANONYMOUS, PUBLISHED_AND_PUBLIC, null)).toBe(null);
  });

  it("does not trust a membership row that names someone else", () => {
    // The row is loaded for the viewer by `authorize.ts`; a mismatch is a
    // corrupt load, and it fails closed rather than handing out access.
    expect(
      membershipOf(VISITOR, PUBLISHED_AND_PUBLIC, collaboratorRow(OWNER)),
    ).toBe(null);
  });
});

describe("canSeeCollection", () => {
  it("admits the owner and every collaborator, public or private", () => {
    for (const membership of [OWNER_MEMBERSHIP, COLLABORATOR_MEMBERSHIP]) {
      for (const coll of [PUBLISHED_AND_PUBLIC, PRIVATE_COLLECTION]) {
        expect(canSeeCollection(membership, coll)).toBe(true);
      }
    }
  });

  it.each([
    ["a visitor", VISITOR],
    ["an anonymous reader", ANONYMOUS],
  ] as const)("admits %s to a public collection only", (_label, viewer) => {
    expect(membershipOf(viewer, PRIVATE_COLLECTION, null)).toBe(NOBODY);
    expect(canSeeCollection(NOBODY, PUBLISHED_AND_PUBLIC)).toBe(true);
    expect(canSeeCollection(NOBODY, PRIVATE_COLLECTION)).toBe(false);
  });
});

describe("canSeeArtwork", () => {
  it("shows the owner and every collaborator every work of the collection", () => {
    // Status and tombstones are the visitor's question, not a member's: a
    // collaborator editing a draft, or restoring a deleted work, must read it.
    for (const membership of [OWNER_MEMBERSHIP, COLLABORATOR_MEMBERSHIP]) {
      for (const row of [LIVE_PUBLISHED, LIVE_DRAFT, DELETED]) {
        for (const coll of [PUBLISHED_AND_PUBLIC, PRIVATE_COLLECTION]) {
          expect(canSeeArtwork(membership, coll, row)).toBe(true);
        }
      }
    }
  });

  it("does not consult the artwork's userId", () => {
    // `artworks.userId` mirrors the owner; it is not an authorization fact.
    // A row a collaborator saved under their own id is still a member's to
    // read, and the row's id does not admit the stranger it names.
    const savedByCollaborator = {
      userId: COLLABORATOR,
      ...LIVE_DRAFT,
    };
    expect(
      canSeeArtwork(
        COLLABORATOR_MEMBERSHIP,
        PUBLISHED_AND_PUBLIC,
        savedByCollaborator,
      ),
    ).toBe(true);

    const namesTheVisitor = { userId: VISITOR, ...LIVE_DRAFT };
    expect(canSeeArtwork(NOBODY, PUBLISHED_AND_PUBLIC, namesTheVisitor)).toBe(
      false,
    );
  });

  it.each([
    ["a visitor", VISITOR],
    ["an anonymous reader", ANONYMOUS],
  ] as const)(
    "shows %s a published, live work of a public collection",
    (_label, viewer) => {
      expect(
        canSeeArtwork(
          membershipOf(viewer, PUBLISHED_AND_PUBLIC, null),
          PUBLISHED_AND_PUBLIC,
          LIVE_PUBLISHED,
        ),
      ).toBe(true);
    },
  );

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
      expect(canSeeArtwork(NOBODY, coll, row)).toBe(false);
    },
  );
});

describe("canReadArtworkDocuments", () => {
  it("admits the owner and every collaborator, whatever the work", () => {
    // The verdict takes no artwork and no collection: status and the
    // collection's flag never move a document.
    expect(canReadArtworkDocuments(OWNER_MEMBERSHIP)).toBe(true);
    expect(canReadArtworkDocuments(COLLABORATOR_MEMBERSHIP)).toBe(true);
  });

  it("refuses a visitor and an anonymous reader", () => {
    // Documents are never public: the collection's gate does not reach them,
    // and a published work in a public collection is the case most likely to
    // be mistaken for one where they are.
    expect(canReadArtworkDocuments(NOBODY)).toBe(false);
  });
});
