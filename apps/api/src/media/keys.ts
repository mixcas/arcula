// The object-key shapes: builders and the parser that turns a key
// back into its segments.
//
// Two prefixes, both self-describing — every segment is an id or a
// variant key, and no user-supplied filename ever reaches a path:
//
//   final:    artworks/{namespaceId}/{collectionId}/{artworkId}/photos/{entryId}_{key}.{ext}
//             artworks/{namespaceId}/{collectionId}/{artworkId}/documents/{entryId}_{key}.{ext}
//   staging:  staging/{uploaderId}/{collectionId}/{artworkId}/{entryId}[_{key}].{ext}
//
// The second segment is not the same fact in the two shapes. A final object
// belongs to the collection, so it is named by the collection's fixed
// `mediaNamespaceId`: a transfer changes the owner and moves no byte. A
// staged object belongs to whoever uploaded it, so it is named by their
// account id and one collaborator never lists another's uploads.
//
// `staging/` leads the staged key on purpose: lifecycle rules match
// literal prefixes, so one `staging/` rule covers every staged object in
// every collection, while no such rule can exist over the nested final
// form. The parser is what makes the proxy's per-request authz and the
// sweep work from the key alone — nothing else is asked of a key.

/** `original` plus the five photo variant keys. `media/variants.ts`
 *  (`IMAGE_VARIANTS`) carries the same five — `tests/pipeline.test.ts`
 *  cross-checks the two so they cannot drift. Exported for that
 *  cross-check and for callers that need the full key space. */
export const OBJECT_KEYS = [
  "original",
  "xlarge",
  "square_lg",
  "square_sm",
  "large",
  "medium",
] as const;

export type MediaPopulation = "photos" | "documents";

/**
 * The collection's fixed media namespace.
 *
 * `mediaNamespaceId` is set when a collection is created and never moves. It
 * is nullable until `0004_media_namespace_not_null` has run: the deploy puts
 * the Lambda before the migrations, so a collection created by the old code
 * in the gap still resolves — to its owner, which is the segment the old
 * code used for every key.
 */
export const mediaNamespaceOf = (collection: {
  mediaNamespaceId: string | null;
  userId: string;
}): string => collection.mediaNamespaceId ?? collection.userId;

/**
 * The final entry's base. The two populations differ by this one segment —
 * which is why the four builders below (and the table in `populations.ts`)
 * name the population rather than their own copy of the shape.
 */
const finalBase = (
  population: MediaPopulation,
  namespaceId: string,
  collectionId: string,
  artworkId: string,
  entryId: string,
): string =>
  `artworks/${namespaceId}/${collectionId}/${artworkId}/${population}/${entryId}`;

export const finalPhotoKey = (
  namespaceId: string,
  collectionId: string,
  artworkId: string,
  entryId: string,
  key: string,
  ext: string,
): string =>
  `${finalBase("photos", namespaceId, collectionId, artworkId, entryId)}_${key}.${ext}`;

export const finalDocumentKey = (
  namespaceId: string,
  collectionId: string,
  artworkId: string,
  entryId: string,
  key: string,
  ext: string,
): string =>
  `${finalBase("documents", namespaceId, collectionId, artworkId, entryId)}_${key}.${ext}`;

/**
 * The two prefixes the staging routes list against — one artwork's staged
 * space, and the caller's whole staged space in a collection (the sweep's).
 *
 * Both carry the uploader's id, never the collection's alone: staging is per
 * uploader (ADR-0004), so listing either reaches the caller's own unsaved
 * uploads and nobody else's. A builder rather than a template at the call
 * site, because that property is the sweep's whole safety.
 */
export const stagedArtworkPrefix = (
  uploaderId: string,
  collectionId: string,
  artworkId: string,
): string => `staging/${uploaderId}/${collectionId}/${artworkId}/`;

export const stagedCollectionPrefix = (
  uploaderId: string,
  collectionId: string,
): string => `staging/${uploaderId}/${collectionId}/`;

export const stagingOriginalKey = (
  uploaderId: string,
  collectionId: string,
  artworkId: string,
  entryId: string,
  ext: string,
): string =>
  `${stagedArtworkPrefix(uploaderId, collectionId, artworkId)}${entryId}.${ext}`;

export const stagingVariantKey = (
  uploaderId: string,
  collectionId: string,
  artworkId: string,
  entryId: string,
  key: string,
  ext: string,
): string =>
  `${stagedArtworkPrefix(uploaderId, collectionId, artworkId)}${entryId}_${key}.${ext}`;

/**
 * The final prefixes that address one entry's objects. Deleting a removed
 * entry lists this prefix and filters through `parseMediaKey` — the
 * character-wise prefix alone is not safe against a sibling entry id:
 * `photos/abc_` also matches entry `abc_d`'s objects, and only the parser
 * recovers the true entry id.
 */
export const finalPhotoPrefix = (
  namespaceId: string,
  collectionId: string,
  artworkId: string,
  entryId: string,
): string =>
  `${finalBase("photos", namespaceId, collectionId, artworkId, entryId)}_`;

export const finalDocumentPrefix = (
  namespaceId: string,
  collectionId: string,
  artworkId: string,
  entryId: string,
): string =>
  `${finalBase("documents", namespaceId, collectionId, artworkId, entryId)}_`;

/**
 * The prefixes that address one staged entry without its siblings.
 *
 * The original is `{entryId}.{ext}` and its variants are
 * `{entryId}_{key}.{ext}`, so a `.` after the id and a `_` after it are the
 * two exact separators. A plain `staging/{u}/{c}/{a}/{entryId}` prefix is
 * NOT safe to delete by: entry `abc` would also sweep entry `abc_d`'s
 * objects. These two prefixes are what discard and the original lookup
 * list against.
 */
export const stagedOriginalPrefix = (
  uploaderId: string,
  collectionId: string,
  artworkId: string,
  entryId: string,
): string =>
  `${stagedArtworkPrefix(uploaderId, collectionId, artworkId)}${entryId}.`;

export const stagedVariantPrefix = (
  uploaderId: string,
  collectionId: string,
  artworkId: string,
  entryId: string,
): string =>
  `${stagedArtworkPrefix(uploaderId, collectionId, artworkId)}${entryId}_`;

/** The unmodified source: no key suffix, so a staged entry is at most
 *  one original plus its generated variants. */
export type ParsedStagingKey = {
  kind: "staging";
  uploaderId: string;
  collectionId: string;
  artworkId: string;
  entryId: string;
  /** `null` for the original, the variant key otherwise. */
  key: string | null;
  ext: string;
};

export type ParsedFinalKey = {
  kind: "final";
  population: MediaPopulation;
  namespaceId: string;
  collectionId: string;
  artworkId: string;
  entryId: string;
  key: string;
  ext: string;
};

export type ParsedMediaKey = ParsedStagingKey | ParsedFinalKey;

/**
 * Split a `{entryId}_{key}` base into its two halves.
 *
 * Entry ids are client-minted and may contain underscores, so the join
 * cannot be split on the first or the last one — `square_lg` itself
 * contains one. What is safe is the other side: the object key comes
 * from a known finite set, and no key is a suffixed neighbour of
 * another (`_large` is not a suffix of `_square_lg`, …), so stripping
 * each known suffix recovers the entry id unambiguously. A base that
 * matches no suffix is an original: entry id, no key.
 */
function splitEntryAndKey(base: string): {
  entryId: string;
  key: string | null;
} {
  for (const key of OBJECT_KEYS) {
    const suffix = `_${key}`;
    if (base.endsWith(suffix)) {
      const entryId = base.slice(0, -suffix.length);
      if (entryId.length > 0) return { entryId, key };
    }
  }
  return { entryId: base, key: null };
}

function splitExt(name: string): { base: string; ext: string } | null {
  const dot = name.lastIndexOf(".");
  // No dot at all, or one at either end, is not a `{base}.{ext}` name.
  if (dot <= 0 || dot === name.length - 1) return null;
  return { base: name.slice(0, dot), ext: name.slice(dot + 1) };
}

/**
 * Parse an object key back into its segments. Returns `null` when the
 * key is not one the app could have built — the proxy turns that into
 * its 404 rather than guessing which row the key might name.
 */
export const parseMediaKey = (key: string): ParsedMediaKey | null => {
  const segments = key.split("/");
  // No empty path segments (no leading/trailing/doubled slashes), no dots
  // in a path segment — an ext belongs to the filename only, which is
  // validated by splitExt below.
  if (segments.slice(0, -1).some((s) => s === "" || s.includes("."))) {
    return null;
  }

  if (segments[0] === "artworks" && segments.length === 6) {
    if (segments[4] !== "photos" && segments[4] !== "documents") return null;
    const name = splitExt(segments[5]);
    if (!name) return null;
    const { entryId, key: objectKey } = splitEntryAndKey(name.base);
    // A final object always names a key: a `{entryId}.{ext}` under
    // `photos/` or `documents/` is not a shape this app writes.
    if (objectKey === null) return null;
    return {
      kind: "final",
      population: segments[4],
      namespaceId: segments[1],
      collectionId: segments[2],
      artworkId: segments[3],
      entryId,
      key: objectKey,
      ext: name.ext,
    };
  }

  if (segments[0] === "staging" && segments.length === 5) {
    const name = splitExt(segments[4]);
    if (!name) return null;
    const { entryId, key: objectKey } = splitEntryAndKey(name.base);
    if (entryId.length === 0) return null;
    return {
      kind: "staging",
      uploaderId: segments[1],
      collectionId: segments[2],
      artworkId: segments[3],
      entryId,
      key: objectKey,
      ext: name.ext,
    };
  }

  return null;
};

/**
 * The stored extension for a content type.
 *
 * The extension never comes from the request: originals keep their
 * source format (PNG stays PNG — alpha), variants are `.webp`, document
 * PDFs are `.pdf`. The content type is what the client declared and
 * what the allowlist admitted, and this map is the only place that
 * declaration becomes a name — so an unaccepted type answers `null`,
 * and `null` is what a caller rejects with, never a guessed `.bin`.
 */
// Extensions are returned WITHOUT a leading dot; the key builders add the
// `.` themselves. Keeping the dot out of this map keeps a single owner of
// "where the dot goes" and makes the "never bin" property assertable.
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const extensionFor = (contentType: string | undefined): string | null =>
  contentType !== undefined && contentType !== ""
    ? (EXT_BY_TYPE[contentType] ?? null)
    : null;

/**
 * The proxy path that serves an object. GET responses fill their `url`
 * fields with these, and the stage/process responses return them so
 * the form can render previews straight from the staged objects without
 * encoding anything itself.
 */
export const mediaUrl = (key: string): string =>
  `/api/v1/media?key=${encodeURIComponent(key)}`;
