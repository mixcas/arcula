// The Selection settings fold: three visibility states in, one PATCH out.
//
// These cases are the product's promise, not an input/output table: Private
// leaves the password alone, Public clears one that was set, and Protected
// either keeps it or validates the new one. A test that restated the fold line
// by line would pass by construction; each expected payload here is derived
// from the contract instead.

import { describe, expect, it } from "vitest";

import {
  needsPasswordFields,
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
