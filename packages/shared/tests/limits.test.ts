import { describe, expect, it } from "vitest";
import { COLLECTION_LIMITS, collectionLimitForTier } from "../src/limits";

/**
 * The cap's number and its fallback, pure (tier 1): the UI reads
 * `collectionLimitForTier` to render "N of 1" and disable the button, and
 * the API's create check reads the same function, so a drift between "what
 * the UI offers" and "what the API admits" is a change this test fails.
 */
describe("collectionLimitForTier", () => {
  it("answers each declared tier with its own entry", () => {
    for (const [tier, limit] of Object.entries(COLLECTION_LIMITS)) {
      expect(collectionLimitForTier(tier)).toBe(limit);
    }
  });

  it("falls back to the free tier for an unknown, null, or absent tier", () => {
    // An unknown tier must fall to `free` — the same fallback the API's
    // create check makes — never to a higher number, which would show a
    // button the server would then refuse.
    expect(collectionLimitForTier("gold")).toBe(COLLECTION_LIMITS.free);
    expect(collectionLimitForTier("")).toBe(COLLECTION_LIMITS.free);
    expect(collectionLimitForTier(null)).toBe(COLLECTION_LIMITS.free);
    expect(collectionLimitForTier(undefined)).toBe(COLLECTION_LIMITS.free);
  });
});
