/**
 * Who may see and run the maintenance screens.
 *
 * This is a **user-interface** gate, not a security boundary, and it is worth
 * being precise about why. A migration only ever writes the signed-in
 * account's own documents (each one selects on `where("userId","==",uid)` and
 * updates through the same owner rules as any other write), so a non-allowlisted
 * user running one would only rewrite their own data. The real protection is
 * `firestore.rules`, which no amount of hiding a link can weaken.
 *
 * What the allowlist buys is that a maintenance tool nobody needs to see stays
 * out of the way. Typing the URL is still possible, so the route is gated with
 * the same check.
 *
 * Entries are email addresses, matched case-insensitively — Firebase treats
 * the local part of an address as case-insensitive in practice, and a mismatch
 * here would silently hide the screen from its owner.
 */
const MAINTENANCE_ADMIN_EMAILS: readonly string[] = ["casska@gmail.com"];

/** True when the signed-in user is allowed to see the maintenance screens. */
export function isMaintenanceAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return MAINTENANCE_ADMIN_EMAILS.some((allowed) => allowed === normalized);
}
