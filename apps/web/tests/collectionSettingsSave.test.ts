// The settings tabs' two save decisions, as pure folds: what each tab's Save
// writes, from the values it loaded and the values it now holds. No DOM, no
// fetch — the payload rules a screenshot cannot prove: which keys a tab
// sends, what a rename does and does not carry, the emptied description as an
// explicit clear, an untouched protected collection sending no password, a
// mismatch answering an error rather than a payload, and the option bag
// compared by value. A tab is clean exactly when its decision answers an
// empty payload — the same fact the disabled Save reads.

import { describe, expect, it } from "vitest";
import {
  resolveGeneralSave,
  resolvePublicSave,
  skinOptionsChanged,
  type GeneralEditedValues,
  type GeneralLoadedValues,
  type PublicEditedValues,
  type PublicLoadedValues,
} from "@/components/manage/collectionSettingsSave";

const generalLoaded = (
  overrides: Partial<GeneralLoadedValues> = {},
): GeneralLoadedValues => ({
  name: "Flores Solares",
  description: "About the wall",
  isPublic: true,
  isPasswordProtected: false,
  ...overrides,
});

const generalEdited = (
  overrides: Partial<GeneralEditedValues> = {},
): GeneralEditedValues => ({
  name: "Flores Solares",
  description: "About the wall",
  isPublic: true,
  password: "",
  confirm: "",
  editingPassword: false,
  removingPassword: false,
  ...overrides,
});

const publicLoaded = (
  overrides: Partial<PublicLoadedValues> = {},
): PublicLoadedValues => ({
  skin: "basicx",
  skinOptions: { transitionSeconds: 4 },
  ...overrides,
});

const publicEdited = (
  overrides: Partial<PublicEditedValues> = {},
): PublicEditedValues => ({
  skin: "basicx",
  skinOptions: { transitionSeconds: 4 },
  ...overrides,
});

describe("resolveGeneralSave", () => {
  it("answers an empty payload for an untouched tab", () => {
    const decision = resolveGeneralSave(generalLoaded(), generalEdited());
    expect(decision).toEqual({ kind: "payload", payload: {} });
  });

  it("carries only the name when the name is the change", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ name: "Renamed" }),
    );
    expect(decision).toEqual({ kind: "payload", payload: { name: "Renamed" } });
  });

  it("carries no name when the edit trims back to the loaded value", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ name: "  Flores Solares  " }),
    );
    expect(decision).toEqual({ kind: "payload", payload: {} });
  });

  it("carries only the visibility when the visibility is the change", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ isPublic: false }),
    );
    expect(decision).toEqual({ kind: "payload", payload: { isPublic: false } });
  });

  it("carries the description when it differs", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ description: "New words" }),
    );
    expect(decision).toEqual({
      kind: "payload",
      payload: { description: "New words" },
    });
  });

  it("sends an emptied description as an explicit clear, never an empty string", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ description: "" }),
    );
    expect(decision).toEqual({
      kind: "payload",
      payload: { description: null },
    });
  });

  it("sends a blanked-to-whitespace description as a clear too", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ description: "   " }),
    );
    expect(decision).toEqual({
      kind: "payload",
      payload: { description: null },
    });
  });

  it("sends no password key when a Protected collection is untouched", () => {
    const decision = resolveGeneralSave(
      generalLoaded({ isPasswordProtected: true }),
      generalEdited({ name: "Renamed" }),
    );
    expect(decision).toEqual({ kind: "payload", payload: { name: "Renamed" } });
  });

  it("carries the password without the confirmation", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ password: "long-enough", confirm: "long-enough" }),
    );
    const payload =
      decision.kind === "payload" ? decision.payload : ({} as never);
    expect(payload.password).toBe("long-enough");
    expect(payload).not.toHaveProperty("confirm");
    expect("name" in payload).toBe(false);
  });

  it("writes a pending removal as a null password", () => {
    const decision = resolveGeneralSave(
      generalLoaded({ isPasswordProtected: true }),
      generalEdited({ removingPassword: true }),
    );
    expect(decision).toEqual({ kind: "payload", payload: { password: null } });
  });

  it("answers an error, not a payload, when the password decision refuses", () => {
    // Both refusals the decision knows — a mismatched confirmation and a
    // password under the shared minimum. Their words are pinned at the
    // password decision's altitude (`collectionPassword.test`); what this
    // fold owes is the kind, so the member is told why and Save stays offered.
    const mismatch = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ password: "long-enough", confirm: "different" }),
    );
    expect(mismatch.kind).toBe("error");
    const short = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ password: "short", confirm: "short" }),
    );
    expect(short.kind).toBe("error");
  });

  it("carries no password on a private collection, even with typed fields", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({
        isPublic: false,
        password: "long-enough",
        confirm: "long-enough",
      }),
    );
    expect(decision).toEqual({ kind: "payload", payload: { isPublic: false } });
  });
});

describe("resolvePublicSave", () => {
  it("answers an empty payload for an untouched tab", () => {
    expect(resolvePublicSave(publicLoaded(), publicEdited())).toEqual({});
  });

  it("carries the skin when it differs from the loaded skin", () => {
    expect(
      resolvePublicSave(publicLoaded(), publicEdited({ skin: "other" })),
    ).toEqual({ skin: "other" });
  });

  it("carries the whole bag when one value differs", () => {
    expect(
      resolvePublicSave(
        publicLoaded(),
        publicEdited({ skinOptions: { transitionSeconds: 8 } }),
      ),
    ).toEqual({ skinOptions: { transitionSeconds: 8 } });
  });

  it("carries nothing for the same bag in a different key order", () => {
    expect(
      resolvePublicSave(
        publicLoaded({ skinOptions: { a: 1, b: true } }),
        publicEdited({ skinOptions: { b: true, a: 1 } }),
      ),
    ).toEqual({});
  });

  it("carries the bag when a key is removed", () => {
    expect(
      resolvePublicSave(
        publicLoaded({ skinOptions: { a: 1, b: true } }),
        publicEdited({ skinOptions: { a: 1 } }),
      ),
    ).toEqual({ skinOptions: { a: 1 } });
  });

  it("sends nothing besides the skin and the bag", () => {
    expect(
      resolvePublicSave(
        publicLoaded(),
        publicEdited({ skin: "other", skinOptions: {} }),
      ),
    ).toEqual({ skin: "other", skinOptions: {} });
  });
});

describe("skinOptionsChanged", () => {
  it("is false for equal bags and true for any value difference", () => {
    expect(skinOptionsChanged({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(false);
    expect(skinOptionsChanged({ a: 1 }, { a: 2 })).toBe(true);
    expect(skinOptionsChanged({ a: 1 }, {})).toBe(true);
    expect(skinOptionsChanged({}, { a: 1 })).toBe(true);
    expect(skinOptionsChanged({}, {})).toBe(false);
  });
});
