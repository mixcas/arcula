// The original's filename, as it rides the direct hop.
//
// A file used to reach the stage route whole, so the route read `file.name`
// and answered it. The bytes now go browser → storage, and the process call
// carries only the entry id, so the name has to be recorded WITH the object at
// presign time or it is lost. Two facts decide how:
//
//   - It is object metadata (`x-amz-meta-name`), not part of the key: no
//     user-supplied name ever becomes a path segment, which is the key
//     algebra's whole invariant.
//   - It is a SIGNED header. Signed means storage refuses a PUT whose header
//     differs from the one the presign signed, so the name cannot be rewritten
//     between the two calls. It also must not be hoisted into the query string
//     — the URL's query reaches access logs and the session replay, and a
//     filename is user content — so `storage.ts` presigns it unhoistable.
//
// HTTP header values are not UTF-8-safe: a browser sends the bytes it is
// given and a name with an accent comes back mangled or refused. So the value
// is percent-encoded on the way in and decoded on the way back, and the pair
// below is the one place that happens — the presign route and the process
// route cannot disagree about it.

/** The signed metadata header's name, `x-amz-meta-` prefixed by S3's rules. */
export const STAGED_NAME_HEADER = "x-amz-meta-name";

/** The name the form shows and the row records, as a header-safe value. */
export const encodeStagedName = (name: string): string =>
  encodeURIComponent(name);

/**
 * The reverse, tolerant of an object that carries no name at all.
 *
 * A presigned PUT has the header signed, so on real S3 an object without it
 * cannot exist. The local stand-in does not verify signatures, and a staged
 * object can also be written out of band by a test; an absent or malformed
 * value answers "untitled" rather than failing the process call, which is the
 * same default the multipart route used for an empty filename.
 */
export const decodeStagedName = (raw: string | null | undefined): string => {
  if (!raw) return "untitled";
  try {
    return decodeURIComponent(raw) || "untitled";
  } catch {
    // A stray `%` is not a name this app wrote; "untitled" is the honest
    // answer, and the bytes are still processed and measured normally.
    return "untitled";
  }
};
