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
  selectionReadSchema,
  selectionSlug,
  selectionUpdateSchema,
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

  it("refuses an unknown key", () => {
    expect(selectionUpdateSchema.safeParse({ isPublic: true }).success).toBe(
      false,
    );
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
