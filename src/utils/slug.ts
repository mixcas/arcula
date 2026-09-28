/**
 * Readable route params for collections and artworks.
 *
 * Routes carry a `{urlizedName}-{id}` segment (FULLSPEC §10) while Firestore
 * only ever knows the raw document id. These helpers are the one place that
 * knows how the two relate, so no caller has to reason about it.
 */

/**
 * Recover the document id from a route param.
 *
 * A urlized name always contains at least one hyphen, and Firestore's
 * auto-generated ids never do, so everything after the last hyphen is the id.
 * A param with no hyphen is already a bare id and comes back unchanged, which
 * keeps older raw-id links working.
 *
 * Callers pass a single path segment, so this never sees the surrounding path.
 * The collection and artwork segments of a nested route are therefore parsed
 * independently of one another.
 */
export const parseId = (param: string): string => {
  const cut = param.lastIndexOf("-");
  return cut === -1 ? param : param.slice(cut + 1);
};

/** Lowercase, runs of non-alphanumerics collapsed to "-", hyphens trimmed. */
export const urlizeName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/**
 * The `{urlizedName}-{id}` route param for a document.
 *
 * `fallback` supplies the readable segment for a name with nothing urlizable in
 * it ("收藏", "!!!"), which would otherwise produce a leading hyphen. Only the
 * id is ever used for a lookup, so that segment is free to be purely cosmetic
 * — and because the param ends in the id, two documents may share a name
 * without colliding.
 */
const docSlug = (name: string, id: string, fallback: string): string =>
  `${urlizeName(name) || fallback}-${id}`;

/** The `:collectionId` route param for a collection. */
export const collectionSlug = (name: string, id: string): string =>
  docSlug(name, id, "collection");

/** The `:artworkId` route param for an artwork, which is named by its title. */
export const artworkSlug = (title: string, id: string): string =>
  docSlug(title, id, "artwork");
