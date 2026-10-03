/**
 * Reading and ordering helpers for `Artwork.photos`.
 *
 * ## Why `order` and the array position both exist
 *
 * Firestore preserves array order, so the array position is already a
 * sequence — which is exactly what makes a denormalized `order` field a
 * liability. The two can drift the moment anything writes one without the
 * other, and the failure is silent: a photo claims to be first while sitting
 * third, and the "primary thumbnail" quietly renders the wrong image.
 *
 * So the rule is narrower than "store the order": the array position is the
 * truth, and `reindexPhotos` rewrites `order` from it on *every* write. The
 * field exists so a reader of the raw document can see the intent without
 * counting array slots, not as a second source that can disagree.
 *
 * Every function here tolerates an absent or malformed `photos` value. Artworks
 * written before uploads existed have `photos: []`, and a reader must not have
 * to know that.
 */

import type {
  Artwork,
  ArtworkPhoto,
  ImageVariant,
  ImageVariantKey,
} from "@/types";

/**
 * The photos in sequence, with `order` renumbered to match array position.
 *
 * This is what gets written. It is also what gets read defensively, since a
 * stored array is trusted no more than any other stored data.
 */
export const reindexPhotos = (photos: ArtworkPhoto[]): ArtworkPhoto[] =>
  photos.map((photo, index) => ({ ...photo, order: index }));

/** The stored photos in sequence order, defensively. Never mutates. */
export const sortPhotos = (
  photos: ArtworkPhoto[] | undefined,
): ArtworkPhoto[] => {
  if (!Array.isArray(photos) || photos.length === 0) {
    return [];
  }
  // A stable sort by `order`, with the array position as the tie-break so two
  // photos claiming the same slot keep a deterministic order instead of one
  // that depends on how the engine happened to return them.
  return photos
    .map((photo, index) => ({ photo, index }))
    .sort(
      (a, b) =>
        (a.photo.order ?? a.index) - (b.photo.order ?? a.index) ||
        a.index - b.index,
    )
    .map(({ photo }) => photo);
};

/** The photo at index 0 — the primary thumbnail. `null` when there are none. */
export const primaryPhoto = (
  artwork: Pick<Artwork, "photos">,
): ArtworkPhoto | null => sortPhotos(artwork.photos)[0] ?? null;

/** Every photo's URL, in sequence. Used by the carousel. */
export const photoUrls = (artwork: Pick<Artwork, "photos">): string[] =>
  sortPhotos(artwork.photos).flatMap((photo) =>
    photo.original.url ? [photo.original.url] : [],
  );

/**
 * A specific variant's URL, falling back through the ladder when it is missing.
 *
 * The fallback is not defensive padding — it is what makes a document written
 * by an older build, or a photo whose variant failed to generate, still render
 * something. `large` before `original` because a missing derivative should show
 * the biggest available image, not the smallest.
 */
export const photoUrl = (
  // A `Pick`, not an `ArtworkPhoto`: an image attached as a document has the
  // same variants and original but no `order` — this list has no sequence and no
  // primary thumbnail, so there would be nothing for that field to mean. Naming
  // the two fields this function actually reads lets such an image reuse the
  // whole ladder without carrying a number nobody maintains.
  photo: Pick<ArtworkPhoto, "variants" | "original"> | null,
  key: ImageVariantKey,
): string | null => {
  if (!photo) {
    return null;
  }
  const variant: ImageVariant | undefined = photo.variants?.find(
    (entry) => entry.key === key,
  );
  return variant?.url ?? photo.original?.url ?? null;
};

/** The primary photo's URL, for a single-image slot such as a table thumbnail. */
export const primaryPhotoUrl = (
  artwork: Pick<Artwork, "photos">,
  key: ImageVariantKey,
): string | null => photoUrl(primaryPhoto(artwork), key);

/**
 * The `srcset` for a photo, built from the variants it *actually has*.
 *
 * A photo uploaded before a variant existed has no object for it, and a
 * `srcset` may only list candidates that resolve: a 404 candidate makes the
 * browser reach for a different one and silently degrade. So `keys` is filtered
 * down to the variants present, in the order given (largest first, by
 * convention).
 *
 * Each candidate is published with that variant's **recorded** width, not its
 * nominal target. `variantSize` never enlarges, so a 300x300 plate's `xlarge`
 * is 300w and not 2400w — and a `w` descriptor that overstates the pixels makes
 * the browser choose a candidate it will then have to upscale.
 *
 * The `original` is deliberately not offered. It is the archival source and can
 * be ten megabytes, which a public slideshow should not be handing to every
 * visitor. `photoUrl` still falls back to it for `src` when a photo has no
 * variants at all — a safety net, not a display choice.
 */
export const photoSrcSet = (
  photo: Pick<ArtworkPhoto, "variants"> | null,
  keys: readonly ImageVariantKey[],
): string | undefined => {
  if (!photo) {
    return undefined;
  }
  const candidates = keys.flatMap((key) => {
    const variant = photo.variants?.find((entry) => entry.key === key);
    return variant?.url && variant.width > 0
      ? [`${variant.url} ${variant.width}w`]
      : [];
  });
  return candidates.length > 0 ? candidates.join(", ") : undefined;
};

/**
 * Whether the stored photos differ from a candidate ordering, by id.
 *
 * The Edit page writes `photos` only when this is true. `updateDoc` merges, so
 * omitting the key leaves the stored array alone — which avoids rewriting
 * fifty storage URLs and re-ordering the document on every save of an unrelated
 * field.
 */
export const photoOrderChanged = (
  stored: ArtworkPhoto[] | undefined,
  candidate: ArtworkPhoto[],
): boolean => {
  const before = sortPhotos(stored).map((photo) => photo.id);
  const after = candidate.map((photo) => photo.id);
  return (
    before.length !== after.length ||
    before.some((id, index) => id !== after[index])
  );
};
