// The headers a staged direct-to-storage upload signs.
//
// Three places have to agree on this list and none of them imports the others:
//
// - `apps/api/src/storage.ts` signs it into every presigned PUT: the content
//   type pins what the object is stored as, and the metadata header carries
//   the original's filename, which the process call no longer receives in a
//   body. The metadata header is signed but deliberately not hoisted into the
//   query string, where a filename would join the bearer token in every access
//   log and session replay.
// - The media bucket's CORS rule must allow exactly this set, because a header
//   the URL signs and the preflight refuses fails the browser's PUT before
//   storage is reached — a rule that looks right but is never hit.
// - `infra/cdk` is deliberately not a workspace member (it installs its own
//   dependencies), so its test reads this file by path instead of importing
//   the package.
//
// The list is therefore the contract, and each side pins itself to it:
// `apps/api/tests/media.api.test.ts` against the signed set the presigner
// actually emits, and `infra/cdk/tests/arcula-stack.test.ts` against the
// bucket rule. Add a header here and both suites go red until each side
// carries it.

/** The signed metadata header the original's filename rides. */
export const STAGED_NAME_HEADER = "x-amz-meta-name";

/**
 * The metadata KEY the presigner is given, which the SDK turns into that
 * header (`x-amz-meta-{key}`). The route and the presigner read this rather
 * than spelling `name` twice.
 */
export const STAGED_NAME_METADATA_KEY = "name";

/**
 * Every header a staged presigned PUT signs, `host` aside — the browser sets
 * it and no CORS rule carries it. The order is the order the presigner builds
 * them; both assertions compare as sorted sets.
 */
export const STAGED_PUT_SIGNED_HEADERS = [
  "content-type",
  STAGED_NAME_HEADER,
] as const;
