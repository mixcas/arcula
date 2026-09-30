import { describe, expect, it } from "vitest";

import {
  DEFAULT_SKIN,
  DEFAULT_SKIN_ID,
  SKINS,
  resolveSkin,
} from "@/skins/registry";

/**
 * The registry's job is to always produce a skin. Every other guarantee about
 * skins is a property of one skin; this is the only place where a mistake
 * blanks a page for a collection whose data was fine.
 */
describe("resolveSkin", () => {
  it("returns the skin a collection names", () => {
    for (const skin of SKINS) {
      expect(resolveSkin(skin.id)).toBe(skin);
    }
  });

  it("falls back to the default for an absent or unknown id", () => {
    // A collection written before skins existed has no `skin` key at all, and a
    // typo in a stored id must not produce a blank page: the caller already
    // holds a document it successfully fetched, so falling back always works.
    expect(resolveSkin(undefined)).toBe(DEFAULT_SKIN);
    expect(resolveSkin(null)).toBe(DEFAULT_SKIN);
    expect(resolveSkin("")).toBe(DEFAULT_SKIN);
    expect(resolveSkin("no-such-skin")).toBe(DEFAULT_SKIN);
    // Case matters: an id is persisted verbatim, and treating these as equal
    // would mean two spellings of the same skin could both exist in the data.
    expect(resolveSkin(DEFAULT_SKIN_ID.toUpperCase())).toBe(DEFAULT_SKIN);
  });
});

/**
 * Structural assertions, so a skin cannot be registered in a half-built state.
 *
 * The `Home`/`Artwork` pair is the contract the shell dispatches on, and a skin
 * missing either one type-checks fine — the registry is typed as an array of
 * `SkinDefinition`, and a skin that declared only `Home` would satisfy nothing
 * but would still compile. These are the checks that would otherwise first be
 * discovered by a visitor landing on a blank page.
 */
describe("the registry", () => {
  it("is not empty, and the default is one of its members", () => {
    expect(SKINS.length).toBeGreaterThan(0);
    expect(SKINS).toContain(DEFAULT_SKIN);
    // The default's id is derived from the default rather than written
    // separately, so these cannot drift; asserted because the id is persisted.
    expect(DEFAULT_SKIN_ID).toBe(DEFAULT_SKIN.id);
  });

  it("has no duplicate ids, which the persisted field requires", () => {
    const ids = SKINS.map((skin) => skin.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every skin both views, a label, and a valid id", () => {
    for (const skin of SKINS) {
      expect(typeof skin.Home, `${skin.id}.Home`).toBe("function");
      expect(typeof skin.Artwork, `${skin.id}.Artwork`).toBe("function");
      expect(skin.label.length, `${skin.id}.label`).toBeGreaterThan(0);
      // Lowercase, hyphenated, no whitespace: the id goes in a Select's value
      // and into Firestore, and is not something a human reads.
      expect(skin.id, `${skin.id}.id`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("gives every skin option a key, a label, and a default matching its kind", () => {
    // The union on `kind` is what lets the settings form pick a control and lets
    // `resolveSkinOptions` validate; a spec whose `default` disagrees with its
    // `kind` compiles (the union is on a literal) but would resolve to a value
    // the skin then has to re-check.
    for (const skin of SKINS) {
      const keys = new Set<string>();
      for (const spec of skin.options) {
        expect(spec.key, `${skin.id}.${spec.key}`).toMatch(/^[a-zA-Z0-9_]+$/);
        expect(
          spec.label.length,
          `${skin.id}.${spec.key}.label`,
        ).toBeGreaterThan(0);
        expect(keys.has(spec.key), `${skin.id}.${spec.key} duplicated`).toBe(
          false,
        );
        keys.add(spec.key);

        switch (spec.kind) {
          case "boolean":
            expect(typeof spec.default).toBe("boolean");
            break;
          case "number":
            expect(typeof spec.default).toBe("number");
            expect(Number.isFinite(spec.default)).toBe(true);
            break;
          case "text":
            expect(typeof spec.default).toBe("string");
            break;
          default: {
            // Exhaustiveness rather than a bare fail: adding a fourth kind to
            // the union should break this switch, not silently skip the check.
            const unhandled: never = spec;
            throw new Error(
              `unhandled option kind ${JSON.stringify(unhandled)}`,
            );
          }
        }
      }
    }
  });
});
