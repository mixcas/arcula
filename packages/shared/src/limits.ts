/**
 * The account tiers the quotas are keyed on.
 *
 * The `user.tier` column (default `'free'`) and `CATALOGUE_LIMITS`
 * below share this vocabulary, so the column and the table cannot name the
 * same thing differently.
 */
export type CatalogueTier = "free";

/**
 * Catalogues per account, by tier.
 *
 * The beta cap: one catalogue per free account. The API enforces this on
 * create (409 when reached) and the client reads it to reflect the cap in the
 * UI — one map, imported by both sides, so the two cannot disagree.
 */
export const CATALOGUE_LIMITS: Record<CatalogueTier, number> = {
  free: 1,
};

/**
 * The catalogue cap for a tier, with the unknown-tier fallback in one place.
 *
 * A `tier` value that is not a key of `CATALOGUE_LIMITS` (a tier added
 * server-side before the client knows it, or a corrupt row) is treated as
 * `free` — the same fallback the API's create check makes, so the UI and the
 * enforcement cannot disagree about a number. Passing `undefined`/`null` is
 * the client's "the profile read is not back yet" state, which also falls
 * to `free` rather than to "no cap".
 */
export function catalogueLimitForTier(tier: string | null | undefined): number {
  if (tier && tier in CATALOGUE_LIMITS) {
    return CATALOGUE_LIMITS[tier as CatalogueTier];
  }
  return CATALOGUE_LIMITS.free;
}
