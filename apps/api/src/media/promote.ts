// Promoting one staged entry to its final objects (plan §6.3, step 3).
//
// Promoting is two things: the S3 `COPY` of the entry's staged objects
// onto their final keys, and the metadata the save transaction records
// as rows. Two properties hold:
//
//   - **Idempotent.** Re-saving the same entry copies onto the same final
//     keys (the copy is a REPLACE) and the save's row writes are upserts,
//     so a retried save lands on the same state.
//   - **Not transactional.** An S3 copy does not roll back with Postgres,
//     so the copies run INSIDE the save transaction and a failed save may
//     leave final objects with no row — the accepted residual (§6),
//     cleaned by Phase 8's sweep-orphans. The staged objects themselves
//     are deleted by the save only AFTER commit; on failure they remain,
//     which is exactly what the sweep and the staging lifecycle exist
//     for.
//
// Variant dimensions come off the geometry table, not a second decode:
// the pipeline encodes deterministically onto the spec's target, and
// tests/pipeline.test.ts asserts recorded == decoded for every key.

import { ApiError } from "../errors";
import { copyObject, headObject, listObjects, readObject } from "../storage";
import {
  extensionFor,
  finalDocumentKey,
  finalPhotoKey,
  parseMediaKey,
  stagedOriginalPrefix,
  stagedVariantPrefix,
} from "./keys";
import { sourceDimensions } from "./pipeline";
import {
  DOCUMENT_VARIANT_SPECS,
  IMAGE_VARIANTS,
  variantSize,
  type ImageVariantSpec,
} from "./variants";

export type PromotionPopulation = "photo" | "document";

export interface PromotedObject {
  /** `original` for the source; a variant key otherwise. */
  key: string;
  size: number;
  contentType: string;
  width: number | null;
  height: number | null;
}

export interface PromotedEntry {
  entryId: string;
  /** The unmodified source. For a document, `kind` decides the row shape. */
  original: PromotedObject & { kind: "file" | "image" };
  /** Spec order; empty for a `file` document. */
  variants: PromotedObject[];
  /** Every staged object the entry occupied; the save deletes these after commit. */
  stagedKeys: string[];
}

export async function promoteEntry(params: {
  population: PromotionPopulation;
  userId: string;
  collectionId: string;
  artworkId: string;
  entryId: string;
}): Promise<PromotedEntry> {
  const { population, userId, collectionId, artworkId, entryId } = params;

  // 1. The staged original: stage writes exactly one, so anything else
  //    means the entry does not exist (any more).
  const originals = await listObjects(
    stagedOriginalPrefix(userId, collectionId, artworkId, entryId),
  );
  if (originals.length !== 1) {
    throw new ApiError(
      "validation",
      `The staged entry "${entryId}" does not exist or was discarded`,
    );
  }
  const originalKey = originals[0];
  const { bytes, contentType } = await readObject(originalKey);
  if (contentType === null) {
    throw new ApiError(
      "internal",
      "A staged object is missing its recorded content type",
    );
  }
  const originalExt = extensionFor(contentType);
  if (originalExt === null) {
    throw new ApiError(
      "internal",
      "A staged object carries a content type the allowlist never admitted",
    );
  }

  // Photos are images by construction (the stage route's allowlist). A
  // document is image/* or application/pdf — the stage route's allowlist
  // again — and `kind` is what the document row records.
  const isImage = contentType.startsWith("image/");
  if (population === "photo" && !isImage) {
    throw new ApiError(
      "validation",
      `The staged entry "${entryId}" is not an image`,
    );
  }
  const kind: "file" | "image" = isImage ? "image" : "file";

  // 2. The staged variants (none for a `file` document: process is a
  //    no-op for a PDF).
  const specs: readonly ImageVariantSpec[] =
    population === "photo" ? IMAGE_VARIANTS : DOCUMENT_VARIANT_SPECS;
  const stagedVariantKeys = await listObjects(
    stagedVariantPrefix(userId, collectionId, artworkId, entryId),
  );

  const variantCopies: { stagedKey: string; object: PromotedObject }[] = [];
  let sourceDims: { width: number; height: number } | null = null;
  if (isImage) {
    sourceDims = await sourceDimensions(bytes);
    const source = sourceDims;
    for (const stagedKey of stagedVariantKeys) {
      // The character-wise prefix reaches sibling entries (entry
      // `abc_d` sits under the prefix `abc_`); only the parser recovers
      // this entry's own objects.
      const parsed = parseMediaKey(stagedKey);
      if (
        parsed === null ||
        parsed.kind !== "staging" ||
        parsed.entryId !== entryId ||
        parsed.key === null
      ) {
        throw new ApiError(
          "internal",
          "Unexpected object in the entry's staging area",
        );
      }
      const spec = specs.find((s) => s.key === parsed.key);
      if (!spec) {
        throw new ApiError(
          "internal",
          `The staged entry "${entryId}" carries an unknown variant "${parsed.key}"`,
        );
      }
      const head = await headObject(stagedKey);
      if (head.ContentLength === undefined || head.ContentType === undefined) {
        throw new ApiError(
          "internal",
          "A staged variant is missing its recorded metadata",
        );
      }
      const variantType = head.ContentType;
      if (extensionFor(variantType) === null) {
        throw new ApiError(
          "internal",
          "A staged variant carries a content type the pipeline never writes",
        );
      }
      const dims = variantSize(spec, source);
      variantCopies.push({
        stagedKey,
        object: {
          key: parsed.key,
          size: head.ContentLength,
          contentType: variantType,
          width: dims.width,
          height: dims.height,
        },
      });
    }
  } else if (stagedVariantKeys.length > 0) {
    // A non-image entry has no variants: state the staging cannot hold.
    throw new ApiError(
      "internal",
      `The staged entry "${entryId}" has variants but is not an image`,
    );
  }

  // 3. Copy to the final keys. REPLACE: re-saving overwrites the same
  //    objects, which is what makes the promote idempotent.
  const finalKey = population === "photo" ? finalPhotoKey : finalDocumentKey;
  await copyObject(
    originalKey,
    finalKey(userId, collectionId, artworkId, entryId, "original", originalExt),
    contentType,
  );
  for (const { stagedKey, object } of variantCopies) {
    const ext = extensionFor(object.contentType);
    if (ext === null) {
      // Unreachable: checked above. The guard keeps a single owner of
      // "the extension is a pure function of the recorded type".
      throw new ApiError("internal", "An uncopyable variant content type");
    }
    await copyObject(
      stagedKey,
      finalKey(userId, collectionId, artworkId, entryId, object.key, ext),
      object.contentType,
    );
  }

  return {
    entryId,
    original: {
      key: "original",
      size: bytes.length,
      contentType,
      width: sourceDims?.width ?? null,
      height: sourceDims?.height ?? null,
      kind,
    },
    variants: variantCopies.map(({ object }) => object),
    stagedKeys: [originalKey, ...stagedVariantKeys],
  };
}
