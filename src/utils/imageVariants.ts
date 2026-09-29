/**
 * The artwork image variant recipe.
 *
 * One table drives everything: the browser encoder, the tests that assert the
 * geometry, and any future server-side implementation. Nothing else in the app
 * should hardcode a pixel size — if a variant is renamed, added or resized, it
 * changes here and the change propagates.
 *
 * The names are a contract with `storage.rules`, which pattern-matches them
 * into the object filename, so adding a key means updating that rule too.
 */

import type { ImageVariantKey } from "@/types";

/** Hard cap on images per artwork. Enforced in the form, not by the rules. */
export const MAX_ARTWORK_PHOTOS = 10;

/**
 * Per-file size cap.
 *
 * Must stay in step with the same constant in `storage.rules`. The rule reads
 * `size <= 10 * 1024 * 1024`, so this is a ceiling the client may hit exactly
 * rather than one the server will reject a byte under.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Image types the form accepts. Mirrored in the Dropzone `accept` map. */
export const ACCEPTED_IMAGE_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

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
 */
export const IMAGE_VARIANTS: readonly ImageVariantSpec[] = [
  { key: "square_lg", fit: "cover", width: 800, height: 800 },
  { key: "square_sm", fit: "cover", width: 400, height: 400 },
  { key: "large", fit: "inside", max: 1200 },
  { key: "medium", fit: "inside", max: 800 },
] as const;

export const VARIANT_KEYS: readonly ImageVariantKey[] = IMAGE_VARIANTS.map(
  (variant) => variant.key,
);

/** The output dimensions a variant produces for a given source size. */
export interface VariantSize {
  width: number;
  height: number;
}

/**
 * The pixel size a variant should be encoded at, given the source dimensions.
 *
 * Pure arithmetic, deliberately separate from any canvas: the geometry is the
 * part worth testing exhaustively and it runs in a plain node test, whereas the
 * canvas has no jsdom implementation. Both square and bounded cases round down
 * to whole pixels — a fractional size is not a thing a canvas accepts.
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
 * Returned in SOURCE coordinates rather than scaled ones, because that is what
 * `drawImage(img, sx, sy, sWidth, sHeight, 0, 0, w, h)` takes. Scaling the
 * source up to cover the box and then offsetting into the overflow would mean
 * reading the canvas transform back to recover the source rect; this does the
 * arithmetic once, up front.
 *
 * Exported because it is the other half of `variantSize` and has the same
 * "worth testing without a canvas" argument.
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

/** True when the browser-reported type is one the form accepts. */
export const isAcceptedImageType = (type: string | undefined): boolean =>
  type !== undefined && type in ACCEPTED_IMAGE_TYPES;
