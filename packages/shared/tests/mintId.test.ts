// The id mint's contract: the shape it emits is a route segment and an
// object-key segment, so the length and the absence of a hyphen are the
// product's own invariants, not preferences. The tree holds two id lengths on
// purpose — ids minted before the shared mint keep their 32 hex characters —
// and the validator (not this module) is what accepts both.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ID_ALPHABET, ID_LENGTH, MINTED_ID_SHAPE_RE, mintId } from "../src/ids";
import { collectionSlug, parseId } from "../src/slug";

/** The one method the mint reads, restated so a test can replace the source. */
interface RandomSource {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

/**
 * A source that answers from a fixed byte script.
 *
 * Each `getRandomValues` call fills the whole array from the script (0 once it
 * runs out), so `[249, 0]` means "one rejected byte, then zeros" — the exact
 * sequence that tells a redraw apart from a modulo.
 */
const scripted = (bytes: number[]): RandomSource => {
  let cursor = 0;
  return {
    getRandomValues<T extends Uint8Array>(array: T): T {
      const target = array as Uint8Array;
      for (let i = 0; i < target.length; i += 1) {
        target[i] = bytes[cursor++] ?? 0;
      }
      return array;
    },
  };
};

/**
 * Load a fresh copy of the module against a chosen platform source.
 *
 * The mint captures the platform source once, at module evaluation, so a
 * static import would keep the source from the first evaluation and neither
 * the scripted-source case nor the absent-source case could be exercised.
 */
const loadMint = async (source?: RandomSource) => {
  vi.stubGlobal("crypto", source);
  vi.resetModules();
  return await import("../src/ids");
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("mintId", () => {
  it("mints exactly ten characters", () => {
    expect(mintId()).toHaveLength(ID_LENGTH);
  });

  it("mints only base62 characters, and never a hyphen", () => {
    const id = mintId();
    expect(id).toMatch(MINTED_ID_SHAPE_RE);
    expect(id).not.toContain("-");
    expect([...id].every((character) => ID_ALPHABET.includes(character))).toBe(
      true,
    );
  });

  it("survives the route parser unchanged", () => {
    // The route carries `{urlizedName}-{id}` and `parseId` cuts at the last
    // hyphen. This is the assertion whose failure is a user's broken link.
    const id = mintId();
    expect(parseId(collectionSlug("Flores Solares", id))).toBe(id);
  });

  it("redraws a byte at or above 248 instead of taking it modulo", async () => {
    // 249 % 62 is 1, so a modulo mint would start the id with "1". A redraw
    // skips 249 and starts with the alphabet's first symbol instead.
    const fresh = await loadMint(scripted([249, 0]));
    expect(fresh.mintId()).toBe("0".repeat(ID_LENGTH));
  });

  it("throws when the platform has no secure source", async () => {
    const fresh = await loadMint(undefined);
    expect(() => fresh.mintId()).toThrow(/secure random source/);
  });
});
