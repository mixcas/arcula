/**
 * The account tiers the quotas are keyed on.
 *
 * The `user.tier` column (Phase 1, default `'free'`) and `COLLECTION_LIMITS`
 * below share this vocabulary, so the column and the table cannot name the
 * same thing differently.
 */
export type CollectionTier = "free";

/**
 * Collections per account, by tier.
 *
 * The beta cap: one collection per free account. The API enforces this on
 * create (409 when reached) and the client reads it to reflect the cap in the
 * UI — one map, imported by both sides, so the two cannot disagree.
 */
export const COLLECTION_LIMITS: Record<CollectionTier, number> = {
  free: 1,
};

/**
 * The collection cap for a tier, with the unknown-tier fallback in one place.
 *
 * A `tier` value that is not a key of `COLLECTION_LIMITS` (a tier added
 * server-side before the client knows it, or a corrupt row) is treated as
 * `free` — the same fallback the API's create check makes, so the UI and the
 * enforcement cannot disagree about a number. Passing `undefined`/`null` is
 * the client's "the profile read is not back yet" state, which also falls
 * to `free` rather than to "no cap".
 */
export function collectionLimitForTier(
  tier: string | null | undefined,
): number {
  if (tier && tier in COLLECTION_LIMITS) {
    return COLLECTION_LIMITS[tier as CollectionTier];
  }
  return COLLECTION_LIMITS.free;
}
