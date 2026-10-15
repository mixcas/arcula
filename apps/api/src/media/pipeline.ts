// The server-side variant pipeline: Sharp decodes once, applies EXIF
// orientation, and encodes every requested variant to WebP.
//
// Sharp always encodes WebP, so there is no capability probe to get
// wrong and no silent `.jpg` downgrade class. The shape of the work is:
// one decode per source, the orientation applied at decode time, and
// the 0.95 quality — a deliberate quality choice rather than a size one.
//
// The geometry itself is not here: it is the variant table in
// `./variants.ts`, and this module consumes it.

import sharp from "sharp";
import type { ImageVariantKey } from "@arcula/shared";
import {
  DOCUMENT_VARIANT_SPECS,
  IMAGE_VARIANTS,
  coverCrop,
  variantSize,
  type ImageVariantSpec,
} from "./variants";

/**
 * The encoder quality, on Sharp's 0–100 scale: 0.95.
 * Artwork is unforgiving of ringing and mush around fine brushwork, and
 * WebP at 95 is visually near-lossless while still being far smaller
 * than a PNG.
 */
export const WEBP_QUALITY = 95;

/** Output format, the only one: variants never come out as anything else. */
export const WEBP_TYPE = "image/webp";

/**
 * The source's pixel dimensions after EXIF orientation.
 *
 * Phone photos carry a rotation tag rather than rotated pixels, and
 * without applying it a portrait scan uploads sideways and every
 * generated variant inherits the mistake permanently. It is applied at
 * decode so all variants, and the recorded width/height, agree with
 * what the camera actually saw.
 *
 * `metadata()` is enough here — no pixel work — and its `autoOrient`
 * field is Sharp's own answer to "what are the display dimensions".
 */
export async function sourceDimensions(
  source: Uint8Array,
): Promise<{ width: number; height: number }> {
  const meta = await sharp(source).metadata();
  const { width, height } = meta.autoOrient ?? {
    width: meta.width,
    height: meta.height,
  };
  if (!width || !height) {
    throw new Error("The image could not be decoded.");
  }
  return { width, height };
}

/** One decode, orientation applied: the raw pixels everything else encodes from. */
export interface OrientedSource {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

export async function orientSource(
  source: Uint8Array,
): Promise<OrientedSource> {
  const { data, info } = await sharp(source)
    // No argument: apply the EXIF orientation tag and strip it,
    // before any resize or crop.
    .rotate()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

/** One encoded variant: the bytes plus what the encoder actually produced. */
export interface RenderedVariant {
  key: ImageVariantKey;
  buffer: Buffer;
  /** Actual encoded pixels, not the nominal target. */
  width: number;
  height: number;
  size: number;
  contentType: string;
}

function rawInput(oriented: OrientedSource) {
  return sharp(oriented.data, {
    raw: {
      width: oriented.width,
      height: oriented.height,
      // Sharp's RawOptions wants the narrow `Channels` union; the channel
      // count is whatever the source actually had (3 or 4), so the value
      // is sound even though `info.channels` is typed as `number`.
      channels: oriented.channels as 1 | 2 | 3 | 4,
    },
  });
}

/**
 * Encode one variant from the already-decoded source.
 *
 * `cover` realises the crop in source pixels first (via `coverCrop`),
 * then resizes the centred window to the box — the box is square by
 * construction, so the aspect is the crop's, not the resize's. `inside`
 * resizes to the exact target the table computed: `fit: "fill"` lands on it
 * pixel for pixel (the target keeps the source aspect by construction), and
 * `withoutEnlargement` is the second lock on the no-upscale rule the
 * table already applies.
 */
async function renderVariant(
  oriented: OrientedSource,
  spec: ImageVariantSpec,
): Promise<RenderedVariant> {
  let pipeline = rawInput(oriented);

  if (spec.fit === "cover") {
    const crop = coverCrop(spec, {
      width: oriented.width,
      height: oriented.height,
    });
    // Extract wants whole pixels; the centred window is off by at most
    // half a pixel, which the following resize absorbs.
    pipeline = pipeline.extract({
      left: Math.round(crop.sx),
      top: Math.round(crop.sy),
      width: Math.max(1, Math.round(crop.sWidth)),
      height: Math.max(1, Math.round(crop.sHeight)),
    });
    pipeline = pipeline.resize(spec.width, spec.height);
  } else {
    const target = variantSize(spec, {
      width: oriented.width,
      height: oriented.height,
    });
    pipeline = pipeline.resize(target.width, target.height, {
      fit: "fill",
      withoutEnlargement: true,
    });
  }

  const { data, info } = await pipeline
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return {
    key: spec.key,
    buffer: data,
    width: info.width,
    height: info.height,
    size: data.length,
    contentType: WEBP_TYPE,
  };
}

/**
 * Every variant the source gets, in spec order (largest first, which the
 * serializer keeps).
 */
export async function generateVariants(
  oriented: OrientedSource,
  specs: readonly ImageVariantSpec[] = IMAGE_VARIANTS,
): Promise<RenderedVariant[]> {
  const rendered: RenderedVariant[] = [];
  for (const spec of specs) {
    rendered.push(await renderVariant(oriented, spec));
  }
  return rendered;
}

export { DOCUMENT_VARIANT_SPECS, IMAGE_VARIANTS };
