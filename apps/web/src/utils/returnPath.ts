/**
 * The return path a page carries through authentication.
 *
 * A protected page that bounces a visitor to sign-in, or an invitation page
 * that offers the same doors, puts the page to come back to in router state
 * under `from.pathname`. State, not a query parameter: it is not
 * user-addressable, so there is no open redirect to sanitise. This module owns
 * both halves of that contract — writing it and reading it — so the writers
 * and the readers cannot disagree about the shape.
 */

export interface ReturnState {
  from?: { pathname?: string };
}

/** The pathname to return to, when the state carries an internal one. */
export function returnPathFrom(state: unknown): string | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const from = (state as { from?: unknown }).from;
  if (typeof from !== "object" || from === null) return undefined;
  const pathname = (from as { pathname?: unknown }).pathname;
  // A single leading slash is an in-app path; anything else ("//host", an
  // absolute URL) is not somewhere this app should send a visitor after auth.
  return typeof pathname === "string" && /^\/(?!\/)/.test(pathname)
    ? pathname
    : undefined;
}

/** The router state that sends a page's visitor back to `pathname`. */
export const returnStateFor = (pathname: string): ReturnState => ({
  from: { pathname },
});
