// The Sharp pipeline: geometry against the variant table, EXIF orientation
// applied before any resize, the no-upscale rule, the document subset, and
// the keys.ts cross-check.
//
// Fixtures are generated with Sharp in-test — no committed binary
// blobs, and the EXIF orientation fixture included (makeOrientedJpeg
// documents how the tag is written in this Sharp version).

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { OBJECT_KEYS } from "../src/media/keys";
import {
  generateVariants,
  orientSource,
  sourceDimensions,
  WEBP_TYPE,
} from "../src/media/pipeline";
import {
  DOCUMENT_IMAGE_VARIANT_KEYS,
  DOCUMENT_VARIANT_SPECS,
  IMAGE_VARIANTS,
  VARIANT_KEYS,
} from "../src/media/variants";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  const { data } = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 60, b: 40 },
    },
  })
    .jpeg()
    .toBuffer({ resolveWithObject: true });
  return data;
}

/**
 * A phone-camera-style JPEG: the pixels are stored sideways and the EXIF
 * Orientation tag says so — orientation 6 is 90° CW, an 800x600 stored
 * image that displays as 600x800. Without the tag being applied before any
 * resize, every variant inherits the sideways pixels permanently.
 *
 * Sharp is what writes the tag (`withMetadata({ orientation })` is the
 * documented write path in 0.35 — verified: `metadata().orientation`
 * reads it back and `.rotate()` without an argument applies it), and
 * reading its own output back is the only way to build the fixture
 * with the toolchain this repo already has.
 */
async function makeOrientedJpeg(
  width: number,
  height: number,
  orientation: number,
): Promise<Buffer> {
  const { data } = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 60, b: 40 },
    },
  })
    .withMetadata({ orientation })
    .jpeg()
    .toBuffer({ resolveWithObject: true });
  return data;
}

const decodedDims = async (bytes: Buffer) => {
  const meta = await sharp(bytes).metadata();
  return { width: meta.width, height: meta.height };
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

describe("generateVariants (photo set)", () => {
  it("produces every key at the table's dimensions, recorded and on the wire", async () => {
    const source = await makeJpeg(1600, 1200);
    const oriented = await orientSource(source);
    expect({ width: oriented.width, height: oriented.height }).toEqual({
      width: 1600,
      height: 1200,
    });

    const variants = await generateVariants(oriented);
    expect(variants.map((v) => v.key)).toEqual([...VARIANT_KEYS]);

    // The table's answer for a 1600x1200 source:
    const expected: Record<string, { width: number; height: number }> = {
      xxlarge: { width: 1600, height: 1200 }, // 3000 cap not reached
      xlarge: { width: 1600, height: 1200 }, // 2400 cap not reached
      square_lg: { width: 800, height: 800 },
      square_sm: { width: 400, height: 400 },
      large: { width: 1200, height: 900 },
      medium: { width: 800, height: 600 },
    };
    for (const variant of variants) {
      expect(variant.contentType).toBe(WEBP_TYPE);
      expect(variant.size).toBe(variant.buffer.length);
      expect(variant.width, variant.key).toBe(expected[variant.key].width);
      expect(variant.height, variant.key).toBe(expected[variant.key].height);
      // Recorded dims are the encoded pixels, not the nominal target:
      // decode the actual bytes and read back what is there.
      expect(await decodedDims(variant.buffer), variant.key).toEqual(
        expected[variant.key],
      );
    }
  });

  it("never enlarges an inside fit", async () => {
    const source = await makeJpeg(300, 200);
    const variants = await generateVariants(await orientSource(source));

    const expected: Record<string, { width: number; height: number }> = {
      xxlarge: { width: 300, height: 200 },
      xlarge: { width: 300, height: 200 },
      large: { width: 300, height: 200 },
      medium: { width: 300, height: 200 },
      // cover fills the box: the square variants do exceed the source.
      square_lg: { width: 800, height: 800 },
      square_sm: { width: 400, height: 400 },
    };
    for (const variant of variants) {
      expect(
        { width: variant.width, height: variant.height },
        variant.key,
      ).toEqual(expected[variant.key]);
      expect(await decodedDims(variant.buffer), variant.key).toEqual(
        expected[variant.key],
      );
    }
  });

  it("generates the document subset only, for document specs", async () => {
    const source = await makeJpeg(1200, 900);
    const variants = await generateVariants(
      await orientSource(source),
      DOCUMENT_VARIANT_SPECS,
    );
    expect(variants.map((v) => v.key)).toEqual(["square_sm", "large"]);
    expect(variants.find((v) => v.key === "large")?.width).toBe(1200); // no upscale
  });
});

// ---------------------------------------------------------------------------
// EXIF orientation before any resize
// ---------------------------------------------------------------------------

describe("EXIF orientation", () => {
  it("reports the transposed source dimensions from metadata alone", async () => {
    // Orientation 6 = 90° CW: the 800x600 pixels display as 600x800.
    const source = await makeOrientedJpeg(800, 600, 6);
    const meta = await sharp(source).metadata();
    expect(meta.orientation).toBe(6);
    expect(meta.autoOrient).toEqual({ width: 600, height: 800 });

    expect(await sourceDimensions(source)).toEqual({
      width: 600,
      height: 800,
    });
  });

  it("orients the pixels before resizing, and the tag does not survive", async () => {
    const source = await makeOrientedJpeg(800, 600, 6);
    const oriented = await orientSource(source);
    expect({ width: oriented.width, height: oriented.height }).toEqual({
      width: 600,
      height: 800,
    });

    const xlarge = (await generateVariants(oriented)).find(
      (v) => v.key === "xlarge",
    )!;
    // xlarge is an inside fit: at 600x800 post-rotation nothing caps,
    // so the output is the transposed source — sideways if the rotation
    // regresses.
    expect({ width: xlarge.width, height: xlarge.height }).toEqual({
      width: 600,
      height: 800,
    });
    expect(await decodedDims(xlarge.buffer)).toEqual({
      width: 600,
      height: 800,
    });
    const outMeta = await sharp(xlarge.buffer).metadata();
    expect(outMeta.orientation ?? 1).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The keys.ts cross-check
// ---------------------------------------------------------------------------

describe("key spaces agree", () => {
  it("OBJECT_KEYS is exactly original + the photo variant keys", () => {
    const expected = new Set<string>(["original", ...VARIANT_KEYS]);
    expect(new Set(OBJECT_KEYS)).toEqual(expected);
    expect(OBJECT_KEYS.length).toBe(expected.size);
    // The parser's suffix matching is only safe because no key is a
    // suffixed neighbour of another.
    for (const a of OBJECT_KEYS) {
      for (const b of OBJECT_KEYS) {
        if (a !== b) {
          expect(`_${a}`.endsWith(`_${b}`)).toBe(false);
        }
      }
    }
  });

  it("documents draw their geometry from the photo table, not a copy of it", () => {
    // Identity, not equality: a hand-copied spec compares equal by value and
    // then drifts the next time the table is resized, which is the second
    // table this rules out. The keys are pinned too, so changing which
    // variants documents get is a visible edit rather than a side effect of
    // editing the table.
    for (const spec of DOCUMENT_VARIANT_SPECS) {
      expect(IMAGE_VARIANTS).toContain(spec);
    }
    expect(DOCUMENT_VARIANT_SPECS.map((spec) => spec.key)).toEqual([
      ...DOCUMENT_IMAGE_VARIANT_KEYS,
    ]);
  });
});
