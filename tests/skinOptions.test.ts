import { describe, expect, it } from "vitest";

import { DEFAULT_SKIN, resolveSkinOptions } from "@/skins/registry";
import { BASICX_OPTION_SPECS } from "@/skins/basicx/options";
import { basicxOptions } from "@/skins/basicx/options";
import type { SkinDefinition } from "@/skins/types";

/** A throwaway skin, so these cases do not depend on Basicx's real options. */
const fakeSkin: SkinDefinition = {
  id: "fake",
  label: "Fake",
  options: [
    { key: "flag", label: "Flag", kind: "boolean", default: true },
    {
      key: "count",
      label: "Count",
      kind: "number",
      default: 3,
      min: 1,
      max: 9,
    },
    { key: "note", label: "Note", kind: "text", default: "hi" },
  ],
  Home: () => null,
  Artwork: () => null,
};

describe("resolveSkinOptions — defaults", () => {
  it("returns every declared key when nothing is stored", () => {
    const { options, dropped } = resolveSkinOptions(fakeSkin, undefined);
    expect(options).toEqual({ flag: true, count: 3, note: "hi" });
    expect(dropped).toEqual([]);
  });

  it("treats null and an empty object the same as absent", () => {
    // A collection written before the field existed has no `skinOptions` key,
    // which Firestore reads as `undefined`; `null` is what a caller may hand
    // over after a merge that removed it.
    expect(resolveSkinOptions(fakeSkin, null).options).toEqual(
      resolveSkinOptions(fakeSkin, undefined).options,
    );
    expect(resolveSkinOptions(fakeSkin, {}).options).toEqual({
      flag: true,
      count: 3,
      note: "hi",
    });
  });

  it("keeps values that are already valid", () => {
    const { options } = resolveSkinOptions(fakeSkin, {
      flag: false,
      count: 7,
      note: "kept",
    });
    expect(options).toEqual({ flag: false, count: 7, note: "kept" });
  });
});

describe("resolveSkinOptions — hostile stored values", () => {
  it("falls back to the default for a wrong type, per key", () => {
    // Per key, not wholesale: a collection with one bad option should keep the
    // owner's other three.
    const { options } = resolveSkinOptions(fakeSkin, {
      flag: "yes",
      count: 5,
      note: 42,
    });
    expect(options).toEqual({ flag: true, count: 5, note: "hi" });
  });

  it("clamps a number outside its bounds rather than defaulting it", () => {
    // The bounds are a UI convenience, not an enforcement. Replacing a stored 8
    // with the default 3 because a NumberInput said `max` would discard the
    // owner's intent over a constraint the skin would have honoured anyway.
    expect(resolveSkinOptions(fakeSkin, { count: 99 }).options.count).toBe(9);
    expect(resolveSkinOptions(fakeSkin, { count: -4 }).options.count).toBe(1);
  });

  it("rejects a number that is not finite", () => {
    // NaN would survive `typeof === "number"` and reach the skin, where it
    // would become a NaN pixel value and an invisible image.
    expect(
      resolveSkinOptions(fakeSkin, { count: Number.NaN }).options.count,
    ).toBe(3);
    expect(
      resolveSkinOptions(fakeSkin, { count: Number.POSITIVE_INFINITY }).options
        .count,
    ).toBe(3);
  });

  it("reports keys the skin no longer declares, rather than dropping them quietly", () => {
    // A skin that renames or removes an option is otherwise indistinguishable
    // from a settings form that never worked, and the owner is the only one who
    // can tell the two apart.
    const { options, dropped } = resolveSkinOptions(fakeSkin, {
      flag: false,
      removedKey: "x",
      anotherOne: 1,
    });
    expect(options).toEqual({ flag: false, count: 3, note: "hi" });
    expect(dropped).toEqual(["removedKey", "anotherOne"]);
  });

  it("does not report a declared key as dropped, even when wrongly typed", () => {
    // The distinction matters: a wrongly-typed value is corrected, while a
    // removed option is a signal that the skin changed under the collection.
    const { dropped } = resolveSkinOptions(fakeSkin, { flag: "nope" });
    expect(dropped).toEqual([]);
  });
});

describe("Basicx's own vocabulary", () => {
  it("declares exactly the one option the spec calls for", () => {
    // Autoplay was cut: a collection homepage is a stack of sections the
    // visitor scrolls at their own pace, and it also removed the only option
    // that depended on another one, which is what keeps `resolveSkinOptions` a
    // flat per-key default with no cross-option logic.
    expect(BASICX_OPTION_SPECS.map((spec) => spec.key)).toEqual([
      "transitionSeconds",
    ]);
  });

  it("no longer offers `showPoweredBy`, which the nav's slot replaced", () => {
    // What belongs in that slot is decided by *who is looking* — the owner gets
    // a manage link, everyone else gets the attribution — so an option for it
    // would be a control that does nothing. The option is removed rather than
    // left inert, so it cannot be mistaken for one that works.
    expect(BASICX_OPTION_SPECS.map((spec) => spec.key)).not.toContain(
      "showPoweredBy",
    );
  });

  // The spec's 0.5s is the default below.
  it("defaults the transition to the specified half second", () => {
    const { options } = resolveSkinOptions(DEFAULT_SKIN, undefined);
    expect(basicxOptions(options)).toEqual({ transitionSeconds: 0.5 });
  });

  it("clamps the transition to the declared range", () => {
    // Bounds come from the spec rather than being repeated, so the settings
    // form and the read path cannot disagree about what 8 means.
    expect(
      basicxOptions(
        resolveSkinOptions(DEFAULT_SKIN, { transitionSeconds: 8 }).options,
      ).transitionSeconds,
    ).toBe(3);
    expect(
      basicxOptions(
        resolveSkinOptions(DEFAULT_SKIN, { transitionSeconds: -1 }).options,
      ).transitionSeconds,
    ).toBe(0);
  });

  it("treats a hand-edited options bag as needing no ceremony", () => {
    // No numeric/enum type on `Collection.skinOptions`, so anything can arrive.
    const hostile: Record<string, unknown> = {
      // A removed option, and a value of the wrong type for the one that
      // remains. Both must resolve to the default, and only the former is
      // reported as dropped — a wrongly-typed value is corrected, while a
      // removed option is a signal that the skin changed under the collection.
      showPoweredBy: "true",
      transitionSeconds: null,
      autoplay: true,
    };
    const { options, dropped } = resolveSkinOptions(DEFAULT_SKIN, hostile);
    expect(basicxOptions(options)).toEqual({ transitionSeconds: 0.5 });
    expect(dropped).toEqual(["showPoweredBy", "autoplay"]);
  });
});
