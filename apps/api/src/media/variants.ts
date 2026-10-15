/**
 * The artwork image variant recipe — the server-side home.
 *
 * One table drives everything: the encoder below, the tests that assert
 * the geometry, and the object-key algebra in `keys.ts`. Nothing else in
 * the app should hardcode a pixel size — if a variant is renamed, added
 * or resized, it changes here and the change propagates.
 *
 * The names are a contract with `media/keys.ts` (`OBJECT_KEYS`), which
 * pattern-matches them into the object filename, and with the proxy,
 * which parses that name back — `tests/pipeline.test.ts` cross-checks
 * the two so a forgotten edit fails CI rather than production.
 */

import type { ImageVariantKey } from "@arcula/shared";

// The caps (`MAX_ARTWORK_PHOTOS`, `MAX_IMAGE_BYTES`) and the accepted-type
// maps live in `@arcula/shared/src/caps.ts`, shared by every side that
// enforces them; the stage routes import them from there.

/** A square variant: scale to cover the box, then crop the overflow off. */
export interface SquareVariantSpec {
  key: ImageVariantKey;
  fit: "cover";
  width: number;
  height: number;
}

/** A bounding-box variant: scale to fit inside it, keeping the aspect ratio. */
export interface BoundedVariantSpec {
  key: ImageVariantKey;
  fit: "inside";
  max: number;
}

export type ImageVariantSpec = SquareVariantSpec | BoundedVariantSpec;

/**
 * The variants, largest first.
 *
 * `fit: "cover"` on a square means the smallest side is scaled up to the box
 * and the overflow is cropped — the source fills the square completely, so a
 * thumbnail is never letterboxed.
 *
 * `fit: "inside"` means the LARGEST side is scaled down to `max` and nothing
 * is cropped, and it never enlarges. The no-upgrade rule is deliberate: a
 * 300x300 book plate must stay 300x300. Scaling it to 800x800 would invent
 * pixels that do not exist and a catalogue is a poor place to store a
 * blurry blowup of the record.
 *
 * `xlarge` exists for the fullscreen slideshow. `large` caps at 1200px, which
 * is smaller than a 1440px display and visibly soft on a detail-heavy painting.
 * The cost is one more object per photo (sixty per ten-photo artwork) and a
 * key change: the `OBJECT_KEYS` list in `keys.ts` must stay in step, or every
 * new variant 404s at the proxy. `tests/pipeline.test.ts` cross-checks the
 * two so a forgotten edit fails CI rather than production.
 *
 * Photos whose source is exactly a variant's target size are still encoded:
 * the server keeps the object set fixed by design — a photo always has its
 * original plus one object per variant key — so the sweep, the proxy and the
 * serializer never have to reason about which keys might be absent.
 */
export const IMAGE_VARIANTS: readonly ImageVariantSpec[] = [
  { key: "xlarge", fit: "inside", max: 2400 },
  { key: "square_lg", fit: "cover", width: 800, height: 800 },
  { key: "square_sm", fit: "cover", width: 400, height: 400 },
  { key: "large", fit: "inside", max: 1200 },
  { key: "medium", fit: "inside", max: 800 },
] as const;

export const VARIANT_KEYS: readonly ImageVariantKey[] = IMAGE_VARIANTS.map(
  (variant) => variant.key,
);

/**
 * The subset an image gets when it is attached as a *document* rather than as
 * a photo.
 *
 * Two of the five, and the two that documents actually use: `square_sm` renders
 * the list tile, `large` fills the preview modal. `square_lg`, `medium` and
 * `xlarge` exist for the public collection views, and a document never appears
 * there — it is refused to visitors by the proxy's document rule. Generating
 * them anyway would write up to three objects per image that nothing can ever
 * read.
 *
 * A subset rather than a second table: the geometry stays defined once, and
 * the object-key algebra already permits the full key list, so narrowing the
 * set here needs no matching change elsewhere.
 */
export const DOCUMENT_IMAGE_VARIANT_KEYS: readonly ImageVariantKey[] = [
  "square_sm",
  "large",
] as const;

/** The specs a document image is generated from — the two keys above. */
export const DOCUMENT_VARIANT_SPECS: readonly ImageVariantSpec[] =
  IMAGE_VARIANTS.filter((spec) =>
    DOCUMENT_IMAGE_VARIANT_KEYS.includes(spec.key),
  );

/** The output dimensions a variant produces for a given source size. */
export interface VariantSize {
  width: number;
  height: number;
}

/**
 * The pixel size a variant should be encoded at, given the source dimensions.
 *
 * Pure arithmetic, deliberately separate from any encoder: the geometry is the
 * part worth testing exhaustively and it runs in a plain node test, whereas
 * the encoder is not cheap to exercise. Both square and bounded cases round
 * down to whole pixels — a fractional size is not a thing a canvas or a
 * decoder accepts.
 */
export const variantSize = (
  spec: ImageVariantSpec,
  source: { width: number; height: number },
): VariantSize => {
  const { width: sw, height: sh } = source;

  if (spec.fit === "cover") {
    // Covering needs the smaller side to reach the box, so the larger axis
    // overflows and is cropped. The box is already the target size, so the
    // result is always exactly square by construction.
    return { width: spec.width, height: spec.height };
  }

  // "inside": shrink the largest side to `max`, never enlarge, never crop.
  const scale = Math.min(1, spec.max / Math.max(sw, sh));
  return {
    width: Math.max(1, Math.round(sw * scale)),
    height: Math.max(1, Math.round(sh * scale)),
  };
};

/**
 * The source-pixel crop rectangle that realises a `cover` fit.
 *
 * Returned in SOURCE coordinates rather than scaled ones. Scaling the
 * source up to cover the box and then offsetting into the overflow would mean
 * reading the transform back to recover the source rect; this does the
 * arithmetic once, up front.
 *
 * Exported because it is the other half of `variantSize` and has the same
 * "worth testing without an encoder" argument.
 */
export const coverCrop = (
  spec: { width: number; height: number },
  source: { width: number; height: number },
): { sx: number; sy: number; sWidth: number; sHeight: number } => {
  const scale = Math.max(
    spec.width / source.width,
    spec.height / source.height,
  );
  // The window we keep, converted back into source pixels by dividing out the
  // scale just computed.
  const sWidth = spec.width / scale;
  const sHeight = spec.height / scale;
  return {
    sx: (source.width - sWidth) / 2,
    sy: (source.height - sHeight) / 2,
    sWidth,
    sHeight,
  };
};
