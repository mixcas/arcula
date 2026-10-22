// The unlock throttle's policy, in one place: how long a window is and where
// an attempt's window starts.
//
// The route owns the rows (`collection_unlock_attempts`, written and read by
// the unlock route alone) and the arithmetic that spends them; this module
// owns the number and the flooring, so the choice between a fixed and a
// sliding window is visible without reading SQL. No database and no Hono.

/** Ten minutes, fixed: the span one counter row counts (ADR-0005). */
export const UNLOCK_WINDOW_MS = 10 * 60 * 1000;

/** The window in whole minutes, for the refusal's own words. */
export const UNLOCK_WINDOW_MINUTES = UNLOCK_WINDOW_MS / 60_000;

/** Ten failures per address and collection spend a window; the eleventh
 *  attempt is refused without a password check. */
export const UNLOCK_MAX_FAILURES = 10;

/**
 * The window an attempt belongs to: **fixed**, floored from the attempt's own
 * time to the window length, not sliding.
 *
 * Fixed is the deliberate choice. A sliding window would have to sum every
 * attempt row in the last ten minutes, and would make each row's meaning
 * depend on the clock rather than on the row; a floored start means one row
 * per (address, collection, window) is the whole state. The price is a
 * boundary burst: whoever spends the last minute of a window on ten failures
 * gets ten more when the next window opens. That is acceptable against a
 * human-chosen password, and it is recorded in ADR-0005 rather than hidden.
 */
export const unlockWindowStart = (now: Date): Date =>
  new Date(Math.floor(now.getTime() / UNLOCK_WINDOW_MS) * UNLOCK_WINDOW_MS);
