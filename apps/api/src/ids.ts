// The API's row ids are the shared mint's, re-exported so every call site —
// collections, a collection's media namespace, CSV-imported artworks,
// invitations — keeps importing one `mintId` while the shape has exactly one
// owner (`@arcula/shared`).
//
// Ten base62 characters, never a hyphen: routes carry the id in a
// `{urlizedName}-{id}` segment and recover it by cutting at the last hyphen,
// and the id is also a final media object key's segment. Ids minted before the
// shared mint existed keep their 32-character hex shape; they are primary keys
// and key segments, so they are never rewritten.
export { mintId } from "@arcula/shared";
