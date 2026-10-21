/**
 * How an invitation's email address is compared.
 *
 * Trimmed and lowercased, on both sides of every comparison: an address is
 * stored in this form and a session's address is normalised on the way in, so
 * " A@B.test " and "a@b.test" are one address to the owner's list, the
 * accept route and the invite page alike. This lives in the shared contract
 * because the API and the SPA both make that comparison; two copies would be
 * two chances to drift.
 */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();
