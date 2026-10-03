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
