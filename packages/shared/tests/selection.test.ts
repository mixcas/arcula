// The Selection contract the API and the web share.
//
// These are the wire and request shapes only: the member list's page envelope,
// the single read, and the create/update bodies. The request schemas are strict
// on purpose — a Selection write names what it changes and nothing else — while
// the read schemas follow the Package's existing read convention and simply
// never carry the password hash.

import { describe, expect, it } from "vitest";
import {
  selectionCreateSchema,
  selectionPageSchema,
  selectionPublicReadSchema,
  selectionReadSchema,
  selectionSlug,
  selectionUnlockSchema,
  selectionUpdateSchema,
  selectionWorksReadSchema,
  selectionWorksReplaceSchema,
  selectionWorksSchema,
} from "../src";

const read = {
  id: "aB3d9Kx2Qp",
  catalogueId: "cat1",
  name: "Fair 2026",
  isPublic: false,
  isPasswordProtected: false,
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 2, nanoseconds: 0 },
};

describe("selectionCreateSchema — POST /catalogues/{cid}/selections", () => {
  it("trims the name and keeps the description", () => {
    expect(
      selectionCreateSchema.parse({
        name: "  Fair 2026 ",
        description: "  Twelve works for the fair. ",
      }),
    ).toEqual({
      name: "Fair 2026",
      description: "Twelve works for the fair.",
      isPublic: false,
    });
  });

  it("turns a blank description into 'nothing', never an empty string", () => {
    const parsed = selectionCreateSchema.parse({
      name: "Fair 2026",
      description: "   ",
    });
    expect(parsed.description).toBeUndefined();
  });

  it("refuses a blank name", () => {
    expect(selectionCreateSchema.safeParse({ name: "   " }).success).toBe(
      false,
    );
  });

  it("is private unless the caller says otherwise", () => {
    expect(selectionCreateSchema.parse({ name: "Fair 2026" }).isPublic).toBe(
      false,
    );
  });

  it("refuses an unknown key", () => {
    expect(
      selectionCreateSchema.safeParse({
        name: "Fair 2026",
        artworkIds: ["aB3d9Kx2Qp"],
      }).success,
    ).toBe(false);
  });
});

describe("selectionUpdateSchema — PATCH /catalogues/{cid}/selections/{sid}", () => {
  it("accepts a description cleared with null", () => {
    expect(selectionUpdateSchema.parse({ description: null })).toEqual({
      description: null,
    });
  });

  it("accepts an absent key as leave-alone", () => {
    expect(selectionUpdateSchema.parse({ name: "Fair Selection" })).toEqual({
      name: "Fair Selection",
    });
  });

  it("refuses an empty name", () => {
    expect(selectionUpdateSchema.safeParse({ name: "  " }).success).toBe(false);
  });

  it("refuses a description that is blank rather than null", () => {
    expect(selectionUpdateSchema.safeParse({ description: "  " }).success).toBe(
      false,
    );
  });

  it("sets visibility and a password, and clears the password with null", () => {
    expect(
      selectionUpdateSchema.parse({
        isPublic: true,
        password: "open-sesame",
      }),
    ).toEqual({ isPublic: true, password: "open-sesame" });
    expect(selectionUpdateSchema.parse({ password: null })).toEqual({
      password: null,
    });
  });

  it("refuses a password too short to be one", () => {
    expect(selectionUpdateSchema.safeParse({ password: "short" }).success).toBe(
      false,
    );
  });

  it("refuses an unknown key", () => {
    expect(
      selectionUpdateSchema.safeParse({ artworkIds: ["aB3d9Kx2Qp"] }).success,
    ).toBe(false);
  });
});

describe("selectionUnlockSchema — POST /selections/{sid}/unlock", () => {
  it("accepts any non-empty guess, however short", () => {
    // The password's length rule belongs to setting it, not to guessing it: a
    // guess that cannot be right is a wrong password, not a malformed request.
    expect(selectionUnlockSchema.parse({ password: "x" })).toEqual({
      password: "x",
    });
  });

  it("refuses an empty password", () => {
    expect(selectionUnlockSchema.safeParse({ password: "" }).success).toBe(
      false,
    );
  });

  it("refuses an unknown key", () => {
    expect(
      selectionUnlockSchema.safeParse({ password: "x", catalogueId: "cat1" })
        .success,
    ).toBe(false);
  });
});

describe("selectionWorksSchema — POST …/selections/{sid}/works (append)", () => {
  it("accepts a list of minted ids", () => {
    expect(
      selectionWorksSchema.parse({ artworkIds: ["aB3d9Kx2Qp", "zY8w7V6u5T"] }),
    ).toEqual({ artworkIds: ["aB3d9Kx2Qp", "zY8w7V6u5T"] });
  });

  it("refuses an empty list: an append names at least one work", () => {
    expect(selectionWorksSchema.safeParse({ artworkIds: [] }).success).toBe(
      false,
    );
  });

  it("refuses an id carrying a hyphen, which `parseId` would cut in two", () => {
    expect(
      selectionWorksSchema.safeParse({ artworkIds: ["aB3d-9Kx2"] }).success,
    ).toBe(false);
  });

  it("tolerates a duplicate: the route appends the one it does not have", () => {
    // A double click, or two tabs on the same list, sends the same id twice.
    // An append is idempotent by design, so this is a valid request rather
    // than a client bug the server has to reject.
    expect(
      selectionWorksSchema.parse({ artworkIds: ["aB3d9Kx2Qp", "aB3d9Kx2Qp"] }),
    ).toEqual({ artworkIds: ["aB3d9Kx2Qp", "aB3d9Kx2Qp"] });
  });

  it("refuses an unknown key", () => {
    expect(
      selectionWorksSchema.safeParse({
        artworkIds: ["aB3d9Kx2Qp"],
        selectionId: "aB3d9Kx2Qp",
      }).success,
    ).toBe(false);
  });
});

describe("selectionWorksReplaceSchema — PUT …/selections/{sid}/works", () => {
  it("accepts an empty list: replace is how the last work leaves", () => {
    expect(selectionWorksReplaceSchema.parse({ artworkIds: [] })).toEqual({
      artworkIds: [],
    });
  });

  it("accepts a reordered list", () => {
    expect(
      selectionWorksReplaceSchema.parse({
        artworkIds: ["zY8w7V6u5T", "aB3d9Kx2Qp"],
      }),
    ).toEqual({ artworkIds: ["zY8w7V6u5T", "aB3d9Kx2Qp"] });
  });

  it("refuses a duplicate id: a list names each work once", () => {
    // The asymmetry with append is deliberate: an append may repeat an id and
    // skip it, because it is a harmless double click; a replace states the
    // whole list, and a repeated id there is a list with no meaning.
    expect(
      selectionWorksReplaceSchema.safeParse({
        artworkIds: ["aB3d9Kx2Qp", "aB3d9Kx2Qp"],
      }).success,
    ).toBe(false);
  });

  it("refuses an id carrying a hyphen", () => {
    expect(
      selectionWorksReplaceSchema.safeParse({ artworkIds: ["aB3d-9Kx2"] })
        .success,
    ).toBe(false);
  });
});

describe("selectionWorksReadSchema — GET /selections/{sid}/artworks", () => {
  const artwork = {
    id: "aB3d9Kx2Qp",
    userId: "u1",
    title: "Untitled",
    artistName: "Unknown",
    documents: [],
    photos: [],
    catalogueId: "cat1",
    status: "draft",
    availability: null,
    deletedAt: null,
    createdAt: { seconds: 1, nanoseconds: 0 },
    updatedAt: { seconds: 1, nanoseconds: 0 },
  };

  it("parses the ordered works envelope", () => {
    const parsed = selectionWorksReadSchema.parse({ artworks: [artwork] });
    expect(parsed.artworks[0].id).toBe("aB3d9Kx2Qp");
    expect(parsed.artworks[0].status).toBe("draft");
  });

  it("refuses a bare array: the read answers an envelope", () => {
    expect(selectionWorksReadSchema.safeParse([artwork]).success).toBe(false);
  });
});

describe("selectionReadSchema — the member read", () => {
  it("parses the document the serializer emits", () => {
    expect(selectionReadSchema.parse(read)).toEqual(read);
  });

  it("never carries the password hash into the parsed document", () => {
    const parsed = selectionReadSchema.parse({
      ...read,
      passwordHash: "scrypt$secret",
    });
    expect(parsed).not.toHaveProperty("passwordHash");
  });
});

describe("selectionPageSchema — the member list", () => {
  it("carries each row's live-work count", () => {
    const page = selectionPageSchema.parse({
      selections: [{ ...read, workCount: 3 }],
    });
    expect(page.selections[0].workCount).toBe(3);
  });

  it("refuses a row without a work count", () => {
    expect(selectionPageSchema.safeParse({ selections: [read] }).success).toBe(
      false,
    );
  });
});

describe("selectionPublicReadSchema — GET /selections/{sid}", () => {
  const publicRead = {
    selection: {
      id: "aB3d9Kx2Qp",
      name: "Fair 2026",
      description: "Twelve works for the fair.",
      isPublic: true,
    },
    catalogueName: "Flores Solares",
    kind: "collection",
    skin: "basicx",
    skinOptions: { transitionSeconds: 0.5, showCaptions: true },
  };

  it("parses the public document and the source presentation", () => {
    expect(selectionPublicReadSchema.parse(publicRead)).toEqual(publicRead);
  });

  it("carries the source Catalogue's Kind and field deviations", () => {
    const parsed = selectionPublicReadSchema.parse({
      ...publicRead,
      kind: "portfolio",
      artworkFields: { medium: false, editions: false },
    });

    expect(parsed.kind).toBe("portfolio");
    expect(parsed.artworkFields).toEqual({ medium: false, editions: false });
  });

  it("requires a Kind and refuses one the product does not know", () => {
    const { kind: _kind, ...withoutKind } = publicRead;
    void _kind;
    expect(selectionPublicReadSchema.safeParse(withoutKind).success).toBe(
      false,
    );
    expect(
      selectionPublicReadSchema.safeParse({ ...publicRead, kind: "gallery" })
        .success,
    ).toBe(false);
  });

  it("allows the field deviations to be absent, as a Catalogue's read does", () => {
    const parsed = selectionPublicReadSchema.parse(publicRead);
    expect(parsed).not.toHaveProperty("artworkFields");
  });

  it("carries the source Catalogue's name but not its id", () => {
    const parsed = selectionPublicReadSchema.parse(publicRead);
    expect(parsed.catalogueName).toBe("Flores Solares");
    expect(parsed).not.toHaveProperty("catalogueId");
    expect(parsed.selection).not.toHaveProperty("catalogueId");
  });

  it("refuses a selection document carrying the source Catalogue's id", () => {
    expect(
      selectionPublicReadSchema.safeParse({
        ...publicRead,
        selection: { ...publicRead.selection, catalogueId: "cat1" },
      }).success,
    ).toBe(false);
  });

  it("refuses a selection document carrying the password's state or hash", () => {
    expect(
      selectionPublicReadSchema.safeParse({
        ...publicRead,
        selection: { ...publicRead.selection, isPasswordProtected: true },
      }).success,
    ).toBe(false);
    expect(
      selectionPublicReadSchema.safeParse({
        ...publicRead,
        selection: { ...publicRead.selection, passwordHash: "scrypt$secret" },
      }).success,
    ).toBe(false);
  });

  it("has no source address to leak", () => {
    expect(
      selectionPublicReadSchema.safeParse({
        ...publicRead,
        cataloguePath: "/catalogue/flores-solares-cat1",
      }).success,
    ).toBe(false);
  });
});

describe("selectionSlug", () => {
  it("puts the urlized name before the id", () => {
    expect(selectionSlug("Fair 2026", "aB3d9Kx2Qp")).toBe(
      "fair-2026-aB3d9Kx2Qp",
    );
  });

  it("falls back to the word selection when nothing is urlizable", () => {
    expect(selectionSlug("收藏", "aB3d9Kx2Qp")).toBe("selection-aB3d9Kx2Qp");
  });
});
