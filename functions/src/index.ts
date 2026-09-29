/**
 * Custodia Cloud Functions (scaffold).
 *
 * TODO(arcula-rename): the product is Arcula now; this comment, the
 * `functions/package.json` name, and its description still say Custodia. See
 * RENAME.md.
 *
 * This file intentionally exports nothing. The first real function to land
 * here is password protection for shared collections (FULLSPEC §9):
 *
 *   - `setCollectionPassword`     callable, owner only, bcrypt-hashes the
 *                                 password (bcryptjs) and stores the hash on
 *                                 the collection document.
 *   - `unlockCollection`          callable, any signed-in visitor, verifies
 *                                 the hash and writes a short-lived grant
 *                                 (e.g. `collectionAccess/{uid}_{collectionId}`
 *                                 with an `expiresAt`) that the Firestore
 *                                 rules check before admitting artworks.
 *
 * Enabling it requires Anonymous Auth for visitors. The Blaze plan is already
 * in place on the project, so billing is no longer part of the question — what
 * is missing is the Anonymous Auth provider and this scaffold's own code.
 * See PublicCollectionPage.tsx and README "Roadmap" for the design notes.
 */
export {};
