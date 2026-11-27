// The settings tabs' two save decisions, as pure folds: what each tab's Save
// writes, from the values it loaded and the values it now holds. No DOM, no
// fetch — the payload rules a screenshot cannot prove: which keys a tab
// sends, what a rename does and does not carry, the emptied description as an
// explicit clear, an untouched protected catalogue sending no password, a
// mismatch answering an error rather than a payload, and the option bag
// compared by value. A tab is clean exactly when its decision answers an
// empty payload — the same fact the disabled Save reads.

import { describe, expect, it } from "vitest";
import type {
  ArtworkFieldStates,
  CatalogueUpdatePayload,
} from "@arcula/shared";
import {
  resolveGeneralSave,
  resolvePublicSave,
  skinOptionsChanged,
  type GeneralEditedValues,
  type GeneralLoadedValues,
  type PublicEditedValues,
  type PublicLoadedValues,
} from "@/components/manage/catalogueSettingsSave";

/** Every switch on — the plainest buffer there is, not any Kind's default. */
const switches = (
  overrides: Partial<ArtworkFieldStates> = {},
): ArtworkFieldStates => ({
  serie: true,
  dateOfCreation: true,
  medium: true,
  dimensions: true,
  editions: true,
  acquisitionDate: true,
  acquisitionPrice: true,
  placeOfOrigin: true,
  provenance: true,
  notes: true,
  condition: true,
  currentValue: true,
  availability: true,
  ...overrides,
});

/** A Collection's exact defaults: the bought-work history on, the rest off. */
const collectionSwitches = (
  overrides: Partial<ArtworkFieldStates> = {},
): ArtworkFieldStates =>
  switches({
    serie: false,
    editions: false,
    condition: false,
    currentValue: false,
    availability: false,
    ...overrides,
  });

/** A Portfolio's defaults: the common core alone. */
const portfolioSwitches = (
  overrides: Partial<ArtworkFieldStates> = {},
): ArtworkFieldStates =>
  switches({
    serie: false,
    editions: false,
    acquisitionDate: false,
    acquisitionPrice: false,
    placeOfOrigin: false,
    provenance: false,
    condition: false,
    currentValue: false,
    availability: false,
    ...overrides,
  });

/** An Inventory's defaults: the represented-work fields and Availability on. */
const inventorySwitches = (
  overrides: Partial<ArtworkFieldStates> = {},
): ArtworkFieldStates =>
  switches({
    serie: false,
    editions: false,
    acquisitionDate: false,
    acquisitionPrice: false,
    condition: false,
    currentValue: false,
    ...overrides,
  });

/** The payload decision, with the defaults/customised state the card reads. */
const decided = (
  payload: CatalogueUpdatePayload,
  artworkFieldsCustomised = false,
) => ({ kind: "payload", payload, artworkFieldsCustomised });

const generalLoaded = (
  overrides: Partial<GeneralLoadedValues> = {},
): GeneralLoadedValues => ({
  name: "Flores Solares",
  description: "About the wall",
  isPublic: true,
  isPasswordProtected: false,
  kind: "collection",
  artworkFields: null,
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
  artworkFields: collectionSwitches(),
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
    expect(decision).toEqual(decided({}));
  });

  it("carries only the name when the name is the change", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ name: "Renamed" }),
    );
    expect(decision).toEqual(decided({ name: "Renamed" }));
  });

  it("carries no name when the edit trims back to the loaded value", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ name: "  Flores Solares  " }),
    );
    expect(decision).toEqual(decided({}));
  });

  it("carries only the visibility when the visibility is the change", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ isPublic: false }),
    );
    expect(decision).toEqual(decided({ isPublic: false }));
  });

  it("carries the description when it differs", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ description: "New words" }),
    );
    expect(decision).toEqual(decided({ description: "New words" }));
  });

  it("sends an emptied description as an explicit clear, never an empty string", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ description: "" }),
    );
    expect(decision).toEqual(decided({ description: null }));
  });

  it("sends a blanked-to-whitespace description as a clear too", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({ description: "   " }),
    );
    expect(decision).toEqual(decided({ description: null }));
  });

  it("sends no password key when a Protected catalogue is untouched", () => {
    const decision = resolveGeneralSave(
      generalLoaded({ isPasswordProtected: true }),
      generalEdited({ name: "Renamed" }),
    );
    expect(decision).toEqual(decided({ name: "Renamed" }));
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
    expect(decision).toEqual(decided({ password: null }));
  });

  it("answers an error, not a payload, when the password decision refuses", () => {
    // Both refusals the decision knows — a mismatched confirmation and a
    // password under the shared minimum. Their words are pinned at the
    // password decision's altitude (`cataloguePassword.test`); what this
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

  it("carries no password on a private catalogue, even with typed fields", () => {
    const decision = resolveGeneralSave(
      generalLoaded(),
      generalEdited({
        isPublic: false,
        password: "long-enough",
        confirm: "long-enough",
      }),
    );
    expect(decision).toEqual(decided({ isPublic: false }));
  });
});

describe("resolveGeneralSave — the Artwork fields switches", () => {
  it("sends no artworkFields key when the switches follow the defaults", () => {
    const decision = resolveGeneralSave(
      generalLoaded({ kind: "collection" }),
      generalEdited(),
    );

    expect(decision).toEqual(decided({}));
  });

  it("carries a field switched off, as the one deviation", () => {
    const decision = resolveGeneralSave(
      generalLoaded({ kind: "collection" }),
      generalEdited({
        artworkFields: collectionSwitches({ provenance: false }),
      }),
    );

    expect(decision).toEqual(
      decided({ artworkFields: { provenance: false } }, true),
    );
  });

  it("carries Availability switched on for a Collection", () => {
    // The switch the flattening adds: a Kind whose default is off can record a
    // market state because the member said so, and the fold sends that one
    // choice rather than the whole arrangement.
    const decision = resolveGeneralSave(
      generalLoaded({ kind: "collection" }),
      generalEdited({
        artworkFields: collectionSwitches({ availability: true }),
      }),
    );

    expect(decision).toEqual(
      decided({ artworkFields: { availability: true } }, true),
    );
  });

  it("carries an explicit on against a default off", () => {
    // The direction a list of disabled fields could not express: a Portfolio
    // records what it paid although its Kind starts the field off.
    const decision = resolveGeneralSave(
      generalLoaded({ kind: "portfolio" }),
      generalEdited({
        artworkFields: portfolioSwitches({ acquisitionPrice: true }),
      }),
    );

    expect(decision).toEqual(
      decided({ artworkFields: { acquisitionPrice: true } }, true),
    );
  });

  it("drops an entry that only restates the Kind's default", () => {
    // Acquisition date is a Portfolio default off; leaving it off is not a
    // choice, and the fold must not write it as one.
    const decision = resolveGeneralSave(
      generalLoaded({ kind: "portfolio" }),
      generalEdited({ artworkFields: portfolioSwitches() }),
    );

    expect(decision).toEqual(decided({}));
  });

  it("sends an empty map for Reset and reports the defaults again", () => {
    const decision = resolveGeneralSave(
      generalLoaded({
        kind: "inventory",
        artworkFields: { medium: false, acquisitionPrice: true },
      }),
      generalEdited({ artworkFields: inventorySwitches() }),
    );

    // Reset returns the buffer to the Kind's defaults; `{}` is the wire's
    // "back to defaults", which the API normalises to null.
    expect(decision).toEqual(decided({ artworkFields: {} }, false));
  });

  it("sends nothing when the switches match the stored deviations", () => {
    const decision = resolveGeneralSave(
      generalLoaded({ kind: "portfolio", artworkFields: { medium: false } }),
      generalEdited({
        artworkFields: portfolioSwitches({ medium: false }),
      }),
    );

    expect(decision).toEqual(decided({}, true));
  });

  it("resolves the same buffer against the Kind it loaded", () => {
    // The same all-on buffer is customised on both Kinds, differently: the
    // Portfolio's nine default-off fields become choices, the Collection's five.
    const portfolio = resolveGeneralSave(
      generalLoaded({ kind: "portfolio" }),
      generalEdited({ artworkFields: switches() }),
    );
    expect(portfolio).toEqual(
      decided(
        {
          artworkFields: {
            serie: true,
            editions: true,
            acquisitionDate: true,
            acquisitionPrice: true,
            placeOfOrigin: true,
            provenance: true,
            condition: true,
            currentValue: true,
            availability: true,
          },
        },
        true,
      ),
    );

    const collection = resolveGeneralSave(
      generalLoaded({ kind: "collection" }),
      generalEdited({ artworkFields: switches() }),
    );
    expect(collection).toEqual(
      decided(
        {
          artworkFields: {
            serie: true,
            editions: true,
            condition: true,
            currentValue: true,
            availability: true,
          },
        },
        true,
      ),
    );
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
