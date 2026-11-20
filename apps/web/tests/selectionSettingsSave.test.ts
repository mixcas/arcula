// The Selection settings fold: three visibility states in, one PATCH out.
//
// These cases are the product's promise, not an input/output table: Private
// leaves the password alone, Public clears one that was set, and Protected
// either keeps it or validates the new one. A test that restated the fold line
// by line would pass by construction; each expected payload here is derived
// from the contract instead.

import { describe, expect, it } from "vitest";
import type { Artwork, Catalogue } from "@arcula/shared";

import {
  catalogueRisk,
  needsPasswordFields,
  publishRisk,
  resolveSelectionSave,
  storedVisibility,
  type SelectionSettingsEdited,
  type SelectionSettingsLoaded,
} from "@/components/manage/catalogue/selectionSettingsSave";

const loaded = (
  overrides: Partial<SelectionSettingsLoaded> = {},
): SelectionSettingsLoaded => ({
  name: "Fair 2026",
  description: "Twelve works for the fair.",
  isPublic: false,
  isPasswordProtected: false,
  ...overrides,
});

const edited = (
  overrides: Partial<SelectionSettingsEdited> = {},
): SelectionSettingsEdited => ({
  name: "Fair 2026",
  description: "Twelve works for the fair.",
  visibility: "private",
  password: "",
  confirm: "",
  editingPassword: false,
  ...overrides,
});

const payloadOf = (
  from: SelectionSettingsLoaded,
  to: SelectionSettingsEdited,
) => {
  const decision = resolveSelectionSave(from, to);
  if (decision.kind !== "payload") {
    throw new Error(decision.message);
  }
  return decision.payload;
};

describe("storedVisibility", () => {
  it.each([
    [{ isPublic: false, isPasswordProtected: false }, "private"],
    [{ isPublic: true, isPasswordProtected: false }, "public"],
    [{ isPublic: true, isPasswordProtected: true }, "protected"],
    // A private Selection may still carry a hash; its state is Private.
    [{ isPublic: false, isPasswordProtected: true }, "private"],
  ] as const)("reads %o as %s", (facts, expected) => {
    expect(storedVisibility(facts)).toBe(expected);
  });
});

describe("resolveSelectionSave — name and description", () => {
  it("writes only what changed, trims it and clears an emptied description", () => {
    expect(
      payloadOf(
        loaded({ isPublic: true }),
        edited({
          name: "  Fair selection  ",
          description: "   ",
          visibility: "public",
        }),
      ),
    ).toEqual({ name: "Fair selection", description: null });
  });

  it("writes nothing when nothing changed", () => {
    expect(
      payloadOf(loaded({ isPublic: true }), edited({ visibility: "public" })),
    ).toEqual({});
  });

  it("refuses a blank name", () => {
    expect(
      resolveSelectionSave(
        loaded(),
        edited({ name: "   ", visibility: "private" }),
      ),
    ).toEqual({ kind: "error", message: "Selection name is required" });
  });
});

describe("resolveSelectionSave — the three visibility states", () => {
  it("publishes a private Selection as Public", () => {
    expect(
      payloadOf(loaded({ isPublic: false }), edited({ visibility: "public" })),
    ).toEqual({ isPublic: true });
  });

  it("publishes it as Protected when a password is given", () => {
    expect(
      payloadOf(
        loaded({ isPublic: false }),
        edited({
          visibility: "protected",
          password: "open-sesame",
          confirm: "open-sesame",
        }),
      ),
    ).toEqual({ isPublic: true, password: "open-sesame" });
  });

  it("keeps an existing password when Protected is chosen again", () => {
    expect(
      payloadOf(
        loaded({ isPublic: true, isPasswordProtected: true }),
        edited({ visibility: "protected" }),
      ),
    ).toEqual({});
  });

  it("clears the password when Protected becomes Public", () => {
    expect(
      payloadOf(
        loaded({ isPublic: true, isPasswordProtected: true }),
        edited({ visibility: "public" }),
      ),
    ).toEqual({ password: null });
  });

  it("leaves a private Selection's password alone", () => {
    // The hash is inert behind a private gate; keeping it means re-publishing
    // does not silently drop the protection.
    expect(
      payloadOf(
        loaded({ isPublic: false, isPasswordProtected: true }),
        edited({ visibility: "private" }),
      ),
    ).toEqual({});
  });
});

describe("resolveSelectionSave — the password's own checks", () => {
  it("refuses Protected with no password", () => {
    const decision = resolveSelectionSave(
      loaded({ isPublic: false }),
      edited({ visibility: "protected" }),
    );
    expect(decision).toEqual({
      kind: "error",
      message: "Enter a password to protect this selection.",
    });
  });

  it("refuses a password shorter than eight characters", () => {
    const decision = resolveSelectionSave(
      loaded({ isPublic: false }),
      edited({
        visibility: "protected",
        password: "short",
        confirm: "short",
      }),
    );
    expect(decision).toEqual({
      kind: "error",
      message: "Password must be at least 8 characters",
    });
  });

  it("refuses a mismatched confirmation", () => {
    const decision = resolveSelectionSave(
      loaded({ isPublic: false }),
      edited({
        visibility: "protected",
        password: "open-sesame",
        confirm: "open-sesamf",
      }),
    );
    expect(decision).toEqual({
      kind: "error",
      message: "The passwords do not match",
    });
  });

  it("changes a set password when the member asks to edit it", () => {
    expect(
      payloadOf(
        loaded({ isPublic: true, isPasswordProtected: true }),
        edited({
          visibility: "protected",
          editingPassword: true,
          password: "a-new-password",
          confirm: "a-new-password",
        }),
      ),
    ).toEqual({ password: "a-new-password" });
  });
});

// The publish warning is the one moment this model's risk is taken: a Selection
// going public while its Catalogue is not visitor-readable. The truth table is
// the state's, the count is the list the page holds now, and a visitor-readable
// Catalogue means there is no risk to name.

type CatalogueFacts = Pick<Catalogue, "isPublic" | "isPasswordProtected">;

/** A Catalogue as the member read gives it: public or not, protected or not. */
const source = (
  isPublic: boolean,
  isPasswordProtected = false,
): CatalogueFacts => ({ isPublic, isPasswordProtected });

const work = (status: "draft" | "published"): Pick<Artwork, "status"> => ({
  status,
});

const riskOf = (input: {
  selectionPublic?: boolean;
  update?: { isPublic?: boolean; name?: string };
  catalogue: CatalogueFacts;
  works?: Array<Pick<Artwork, "status">>;
}) =>
  publishRisk({
    selection: { isPublic: input.selectionPublic ?? false },
    update: input.update ?? { isPublic: true },
    catalogue: input.catalogue,
    works: input.works ?? [],
  });

describe("publishRisk", () => {
  it("names a private catalogue and counts the drafts the publish reveals", () => {
    expect(
      riskOf({
        catalogue: source(false),
        works: [work("draft"), work("published"), work("draft")],
      }),
    ).toEqual({ catalogueState: "private", draftCount: 2 });
  });

  it("names a protected catalogue as protected", () => {
    expect(
      riskOf({
        catalogue: source(true, true),
        works: [work("draft")],
      }),
    ).toEqual({ catalogueState: "protected", draftCount: 1 });
  });

  it("says nothing when a visitor can already read the catalogue", () => {
    expect(
      riskOf({ catalogue: source(true), works: [work("draft")] }),
    ).toBeNull();
  });

  it("says nothing when the selection is already public", () => {
    expect(
      riskOf({
        selectionPublic: true,
        catalogue: source(false),
        works: [work("draft")],
      }),
    ).toBeNull();
  });

  it("says nothing when the save does not publish", () => {
    expect(
      riskOf({ update: { name: "Fair selection" }, catalogue: source(false) }),
    ).toBeNull();
    expect(
      riskOf({ update: { isPublic: false }, catalogue: source(false) }),
    ).toBeNull();
  });

  it("counts no drafts as zero rather than inventing a warning", () => {
    expect(
      riskOf({ catalogue: source(false), works: [work("published")] }),
    ).toEqual({ catalogueState: "private", draftCount: 0 });
    expect(riskOf({ catalogue: source(false), works: [] })).toEqual({
      catalogueState: "private",
      draftCount: 0,
    });
  });

  it("counts the list the page holds now, not the one it loaded", () => {
    expect(
      riskOf({
        catalogue: source(false),
        works: [work("draft"), work("draft"), work("draft")],
      })?.draftCount,
    ).toBe(3);
    // The same call after curation: the count follows the list it is given.
    expect(
      riskOf({
        catalogue: source(false),
        works: [work("published"), work("published")],
      })?.draftCount,
    ).toBe(0);
  });
});

describe("catalogueRisk", () => {
  it("carries the state and the draft count while the state holds", () => {
    expect(
      catalogueRisk(source(false), [work("draft"), work("published")]),
    ).toEqual({ catalogueState: "private", draftCount: 1 });
    expect(catalogueRisk(source(true, true), [])).toEqual({
      catalogueState: "protected",
      draftCount: 0,
    });
  });

  it("is silent once a visitor can read the catalogue", () => {
    expect(catalogueRisk(source(true), [work("draft")])).toBeNull();
  });
});

describe("needsPasswordFields", () => {
  it("shows the fields to become Protected, or to change an existing password", () => {
    expect(
      needsPasswordFields(
        { isPasswordProtected: false },
        { visibility: "protected", editingPassword: false },
      ),
    ).toBe(true);
    expect(
      needsPasswordFields(
        { isPasswordProtected: true },
        { visibility: "protected", editingPassword: false },
      ),
    ).toBe(false);
    expect(
      needsPasswordFields(
        { isPasswordProtected: true },
        { visibility: "protected", editingPassword: true },
      ),
    ).toBe(true);
    expect(
      needsPasswordFields(
        { isPasswordProtected: false },
        { visibility: "public", editingPassword: false },
      ),
    ).toBe(false);
  });
});
