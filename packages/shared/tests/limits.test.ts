import { describe, expect, it } from "vitest";
import { CATALOGUE_LIMITS, catalogueLimitForTier } from "../src/limits";

/**
 * The cap's number and its fallback, pure (tier 1): the UI reads
 * `catalogueLimitForTier` to render the counter and disable the button, and
 * the API's create check reads the same function, so a drift between "what
 * the UI offers" and "what the API admits" is a change this test fails.
 */
describe("catalogueLimitForTier", () => {
  it("allows at least one catalogue — a cap of 0 would silently disable create", () => {
    // A correctness floor, not a preference. `free: 0` (or a negative or NaN
    // from a bad edit) would not refuse a create with a 409 — it would make
    // one impossible, while the UI still offered the button.
    expect(Number.isInteger(CATALOGUE_LIMITS.free)).toBe(true);
    expect(CATALOGUE_LIMITS.free).toBeGreaterThan(0);
  });

  it("falls back to the free tier for an unknown, null, or absent tier", () => {
    // An unknown tier must fall to `free` — the same fallback the API's
    // create check makes — never to a higher number, which would show a
    // button the server would then refuse, and never to `undefined`, which
    // would render a blank count and disable create outright.
    expect(catalogueLimitForTier("gold")).toBe(CATALOGUE_LIMITS.free);
    expect(catalogueLimitForTier("")).toBe(CATALOGUE_LIMITS.free);
    expect(catalogueLimitForTier(null)).toBe(CATALOGUE_LIMITS.free);
    expect(catalogueLimitForTier(undefined)).toBe(CATALOGUE_LIMITS.free);
  });
});
