// The staged-media routes:
//
//   POST   …/photos/stage       — multipart original → the staged key
//   POST   …/photos/process     — { entryId } → variants into staging
//   DELETE …/photos/{entryId}   — discard a staged entry
//   … and the same three under /documents
//
// Staging needs only MEMBERSHIP of the collection, not an existing artwork
// row: the Add flow mints the artwork id client-side, stages under it, and
// the save route creates the row and promotes the entries in one
// transaction. The artwork id is validated as an id-shaped segment and
// used as the staging key's segment; nothing else is asked of it here.
//
// The uploader segment is always the CALLER, never the collection's owner:
// staging is per uploader (ADR-0004), so a collaborator's stage, process and
// discard reach only their own staged objects and one member can neither
// process nor discard another's unsaved upload.

import { MINTED_ID_RE } from "@arcula/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireMemberCollection } from "../authorize";
import { errorResponse, ApiError } from "../errors";
import { param } from "../http";
import { requireSession } from "../session";
import {
  extensionFor,
  mediaUrl,
  parseMediaKey,
  stagedArtworkPrefix,
  stagedOriginalPrefix,
  stagingOriginalKey,
  stagingVariantKey,
} from "../media/keys";
import {
  POPULATION_KINDS,
  POPULATIONS,
  type PopulationKind,
} from "../media/populations";
import {
  generateVariants,
  orientSource,
  sourceDimensions,
  WEBP_TYPE,
} from "../media/pipeline";
import { deleteObject, listObjects, putObject, readObject } from "../storage";

// Ids are client-minted and become key segments: letters, digits, dash,
// underscore — nothing that could carry a path separator or a dot. The
// shared MINTED_ID_RE is the single owner of that character set (also
// the save payloads').

/** A validation failure with the failed fields, per the error envelope. */
function invalid(message: string, fields?: Record<string, string>) {
  return new ApiError("validation", message, fields ? { fields } : undefined);
}

const isImage = (contentType: string | null): boolean =>
  contentType !== null && contentType.startsWith("image/");

/** The entry's staged objects: original + every variant, listed and
 *  filtered rather than named (the extension is not known here).
 *
 * The filter is the parser, not a string prefix: a bare
 * `staging/{u}/{c}/{a}/{entryId}_` prefix would also match entry
 * `abc_d`'s objects when the entry is `abc`, and only the parser —
 * which recovers the entry id against the known key set — can tell
 * `abc_xlarge.webp` from `abc_d.jpg`. */
async function discardEntry(
  userId: string,
  collectionId: string,
  artworkId: string,
  entryId: string,
): Promise<number> {
  const keys = await listObjects(
    stagedArtworkPrefix(userId, collectionId, artworkId),
  );
  const doomed = keys.filter((key) => {
    const parsed = parseMediaKey(key);
    return parsed?.kind === "staging" && parsed.entryId === entryId;
  });
  for (const key of doomed) {
    await deleteObject(key);
  }
  return doomed.length;
}

export function buildMediaRoutes(kind: PopulationKind): Hono {
  const pop = POPULATIONS[kind];
  const r = new Hono();

  // requireSession is attached per route, NOT via `use("*")`: this sub-app
  // is mounted at /api/v1, and a sub-app `use("*")` is re-registered on the
  // parent as /api/v1/* — which would 401 every anonymous /api/v1 request
  // (the public reads) the moment this app is mounted.
  //
  // A coarse guard ahead of parseBody: the exact per-file cap is checked
  // on the parsed file below (the multipart overhead is the slack here).
  const limit = bodyLimit({
    maxSize: pop.cap + 1024 * 1024,
    onError: (c) => {
      const { body, status } = errorResponse(
        new ApiError("validation", "The file is too large"),
      );
      return c.json(body, status);
    },
  });

  // ------------------------------------------------------------------
  // Stage
  // ------------------------------------------------------------------
  r.post(`/${pop.population}/stage`, requireSession, limit, async (c) => {
    const collection = await requireMemberCollection(
      c,
      param(c, "collectionId"),
    );
    const artworkId = param(c, "artworkId");
    if (!MINTED_ID_RE.test(artworkId)) {
      throw invalid("The artwork id is not valid");
    }

    const body = await c.req.parseBody();
    const entryId = body.entryId;
    const file = body.file;
    if (typeof entryId !== "string" || !MINTED_ID_RE.test(entryId)) {
      throw invalid("A valid entryId field is required", {
        entryId: "required",
      });
    }
    if (!(file instanceof File)) {
      throw invalid("A file field is required", { file: "required" });
    }

    // The allowlist runs before the size check: a forged type is a
    // different failure than an honest one that is too big, and the
    // extension (hence the object name) is only minted from admitted
    // types — SVG/HTML reach no key.
    if (!pop.accepted[file.type]) {
      throw invalid("The file type is not accepted", {
        file: "unsupported type",
      });
    }
    if (file.size > pop.cap) {
      throw invalid("The file is too large", { file: "too large" });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = extensionFor(file.type);
    if (ext === null) {
      throw invalid("The file type is not accepted", {
        file: "unsupported type",
      });
    }

    let width: number | null = null;
    let height: number | null = null;
    if (isImage(file.type)) {
      try {
        ({ width, height } = await sourceDimensions(bytes));
      } catch {
        throw invalid("The image could not be decoded", {
          file: "undecodable",
        });
      }
    }

    // Re-staging replaces: a failed re-upload of the same entry must
    // not leave the previous original (or its variants, under a
    // different extension) to be swept into the save.
    await discardEntry(c.get("user").id, collection.id, artworkId, entryId);

    const key = stagingOriginalKey(
      c.get("user").id,
      collection.id,
      artworkId,
      entryId,
      ext,
    );
    await putObject(key, bytes, file.type);

    return c.json({
      entryId,
      name: file.name || "untitled",
      width,
      height,
      size: bytes.length,
      contentType: file.type,
      url: mediaUrl(key),
    });
  });

  // ------------------------------------------------------------------
  // Process
  // ------------------------------------------------------------------
  r.post(`/${pop.population}/process`, requireSession, async (c) => {
    const collection = await requireMemberCollection(
      c,
      param(c, "collectionId"),
    );
    const artworkId = param(c, "artworkId");
    if (!MINTED_ID_RE.test(artworkId)) {
      throw invalid("The artwork id is not valid");
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw invalid("Invalid JSON body");
    }
    const entryId = (raw as { entryId?: unknown })?.entryId;
    if (typeof entryId !== "string" || !MINTED_ID_RE.test(entryId)) {
      throw invalid("A valid entryId is required", { entryId: "required" });
    }

    const userId = c.get("user").id;
    const originals = await listObjects(
      stagedOriginalPrefix(userId, collection.id, artworkId, entryId),
    );
    if (originals.length === 0) {
      throw new ApiError(
        "not-found",
        "The staged entry does not exist or has been discarded",
      );
    }

    const { bytes, contentType } = await readObject(originals[0]);

    if (!isImage(contentType)) {
      // A PDF document has no variants: the original is the whole entry.
      return c.json({ entryId, variants: [] });
    }

    let oriented;
    try {
      oriented = await orientSource(bytes);
    } catch {
      throw invalid("The image could not be decoded", { file: "undecodable" });
    }

    const generated = await generateVariants(oriented, pop.specs);
    const variants = [];
    for (const variant of generated) {
      const key = stagingVariantKey(
        userId,
        collection.id,
        artworkId,
        entryId,
        variant.key,
        "webp",
      );
      await putObject(key, variant.buffer, WEBP_TYPE);
      variants.push({
        key: variant.key,
        url: mediaUrl(key),
        width: variant.width,
        height: variant.height,
        size: variant.size,
        contentType: variant.contentType,
      });
    }
    return c.json({ entryId, variants });
  });

  // ------------------------------------------------------------------
  // Discard
  // ------------------------------------------------------------------
  r.delete(`/${pop.population}/:entryId`, requireSession, async (c) => {
    const collection = await requireMemberCollection(
      c,
      param(c, "collectionId"),
    );
    const artworkId = param(c, "artworkId");
    if (!MINTED_ID_RE.test(artworkId)) {
      throw invalid("The artwork id is not valid");
    }
    const entryId = param(c, "entryId");
    if (!MINTED_ID_RE.test(entryId)) {
      throw invalid("The entry id is not valid");
    }

    const deleted = await discardEntry(
      c.get("user").id,
      collection.id,
      artworkId,
      entryId,
    );
    // Idempotent: discarding a discarded (or never staged) entry is a
    // no-op, not an error — the form removes tiles more than once.
    return c.json({ entryId, deleted });
  });

  return r;
}

/** The media routes, mounted at `/api/v1` (paths carry their own segments). */
export const artworkMediaRoutes = new Hono();

for (const kind of POPULATION_KINDS) {
  const routes = buildMediaRoutes(kind);
  artworkMediaRoutes.route(
    `/collections/:collectionId/artworks/:artworkId`,
    routes,
  );
}
