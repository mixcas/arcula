/**
 * The address a sign-in hands to the password-reset request.
 *
 * Router state under `email`, for the same reason the return path is: it is
 * not user-addressable, so there is nothing to sanitise. This module owns both
 * halves — the writer sign-in uses and the reader the request screen uses — so
 * the two cannot disagree about the shape.
 *
 * The reader is deliberately forgiving. The request screen must stand alone as
 * a bookmark, and the reset form's expired-link message links to it with no
 * state at all, so anything that is not a plain `{ email: string }` reads as an
 * empty address rather than throwing or rendering `undefined`.
 */

export interface ResetRequestState {
  email?: string;
}

/** The address the request form should start with; empty when state carries none. */
export function resetRequestEmailFrom(state: unknown): string {
  if (typeof state !== "object" || state === null) return "";
  const email = (state as { email?: unknown }).email;
  return typeof email === "string" ? email : "";
}

/** The router state that hands `email` to the request screen. */
export const resetRequestStateFor = (email: string): ResetRequestState => ({
  email,
});
