// The staged-media routes:
//
//   POST   …/photos/stage       — a declaration → a presigned upload target
//   POST   …/photos/process     — { entryId } → the original's metadata + variants
//   DELETE …/photos/{entryId}   — discard a staged entry
//   … and the same three under /documents
//
// Staging needs only MEMBERSHIP of the catalogue, not an existing artwork
// row: the Add flow mints the artwork id client-side, stages under it, and
// the save route creates the row and promotes the entries in one
// transaction. The artwork id is validated as an id-shaped segment and
// used as the staging key's segment; nothing else is asked of it here.
//
// The uploader segment is always the CALLER, never the catalogue's owner:
// staging is per uploader (ADR-0004), so a collaborator's stage, process and
// discard reach only their own staged objects and one member can neither
// process nor discard another's unsaved upload.
//
// ## The bytes never pass through this app
//
// A file used to travel in a multipart body and the stage route held it, so
// it measured and decoded on the way in. That is what a Lambda's 6 MB
// invocation payload broke: a phone photo is base64-inflated in transit and
// refused before Hono ever reads it. So the two routes now split one job:
//
//   - **stage presigns.** It reads a DECLARATION — content type, declared
//     length, name — refuses one the population's allowlist or cap does not
//     admit, and mints a short-lived PUT URL for the staged key. It never
//     sees a byte, so nothing it answers is a measurement.
//   - **process validates.** It is the first point the server sees the
//     object, so the allowlist and the cap are re-checked against the STORED
//     content type and the stored length, and an image is decoded. A forged
//     declaration at presign therefore buys nothing: the only thing it can
//     reach is a failed process and an object the sweep removes.
//
// The presigned URL carries no authority beyond one PUT on one staged key,
// and the key still names the uploader — a member's URL can only ever write
// inside their own staging prefix.
//
// `name` is recorded on the object at presign (a signed `x-amz-meta-name`
// header, see `media/stagedName.ts`), because the process body carries only
// the entry id and the answer still has to name the original.
//
// The routes mount under the catalogue's own address, carrying their own
// segments, from one route app and one set of handlers.

import {
  checkDeclaredUpload,
  MINTED_ID_RE,
  mediaPresignRequestSchema,
  STAGED_NAME_METADATA_KEY,
  type DeclaredUploadVerdict,
  type MediaPresignResponse,
  type MediaProcessResponse,
} from "@arcula/shared";
import { Hono } from "hono";
import { requireMemberCatalogue } from "../authorize";
import { ApiError } from "../errors";
import { param, parseBody } from "../http";
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
  hasPdfSignature,
  orientSource,
  WEBP_TYPE,
} from "../media/pipeline";
import { decodeStagedName, encodeStagedName } from "../media/stagedName";
import {
  deleteObject,
  headObject,
  isObjectMissing,
  listObjects,
  PRESIGNED_PUT_TTL_SECONDS,
  presignPut,
  putObject,
  readObject,
} from "../storage";

// Ids are client-minted and become key segments: letters and digits only —
// nothing that could carry a path separator, a dot or a hyphen (the route
// parser cuts at the last hyphen). The shared MINTED_ID_RE is the single owner
// of that character set (also the save payloads').

/** A validation failure with the failed fields, per the error envelope. */
function invalid(message: string, fields?: Record<string, string>) {
  return new ApiError("validation", message, fields ? { fields } : undefined);
}

/**
 * A refused declaration or a refused object, as the form reads it.
 *
 * One function for both ends of the hop: presign judges the declaration and
 * process judges the stored object, and the person who forged nothing should
 * not be told two different things depending on which end caught it. The
 * `fields.file` values are the vocabulary the uploaders already surface
 * (`useArtworkPhotos` reads `fields.file` first).
 */
function refusal(verdict: DeclaredUploadVerdict): ApiError {
  switch (verdict) {
    case "unsupported-type":
      return invalid("The file type is not accepted", {
        file: "unsupported type",
      });
    case "too-large":
      return invalid("The file is too large", { file: "too large" });
    case "invalid-size":
      // Not the same as too large: a zero, a fraction or a non-finite length
      // is a malformed request, and saying "too large" would send someone
      // looking for a smaller file that does not exist.
      return invalid("The file size is not valid", { file: "invalid size" });
    case "allowed":
      // Not reachable through the call sites; the type keeps them honest.
      throw new Error("A refused upload cannot be allowed");
  }
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
  catalogueId: string,
  artworkId: string,
  entryId: string,
): Promise<number> {
  const keys = await listObjects(
    stagedArtworkPrefix(userId, catalogueId, artworkId),
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
  // There is no body limit any more: the route reads a JSON declaration, and
  // the bytes go straight to storage. The declared size is capped by the
  // shared guard, and the stored length by process.

  // ------------------------------------------------------------------
  // Stage: presign
  // ------------------------------------------------------------------
  r.post(`/${pop.population}/stage`, requireSession, async (c) => {
    const catalogue = await requireMemberCatalogue(c, param(c, "catalogueId"));
    const artworkId = param(c, "artworkId");
    if (!MINTED_ID_RE.test(artworkId)) {
      throw invalid("The artwork id is not valid");
    }

    const declaration = await parseBody(c, mediaPresignRequestSchema);

    // The declaration is all presign has. The shared guard is the single
    // owner of the allowlist and the cap; its order (type, then size) is the
    // old stage route's, so a forged type is still reported as a type failure
    // rather than as an honest file that is too big.
    const verdict = checkDeclaredUpload(
      kind,
      declaration.contentType,
      declaration.size,
    );
    if (verdict !== "allowed") {
      throw refusal(verdict);
    }

    // The allowlist admitted the type, and this map is the one place a type
    // becomes a name. A `null` here would mean the two tables disagree; the
    // branch keeps "never a guessed extension" true rather than building a
    // key ending in `null`.
    const ext = extensionFor(declaration.contentType);
    if (ext === null) {
      throw refusal("unsupported-type");
    }

    // Re-staging replaces: a failed re-upload of the same entry must not
    // leave the previous original (or its variants, under a different
    // extension) to be swept into the save. It runs AFTER the declaration is
    // admitted, so a refused re-upload cannot destroy the entry that was
    // already staged and valid.
    await discardEntry(
      c.get("user").id,
      catalogue.id,
      artworkId,
      declaration.entryId,
    );

    const key = stagingOriginalKey(
      c.get("user").id,
      catalogue.id,
      artworkId,
      declaration.entryId,
      ext,
    );
    // The name rides the object as a signed metadata header: the process
    // body carries only the entry id, and its answer still has to name the
    // original. Encoded because a header is not a place for arbitrary UTF-8.
    const upload = await presignPut(key, declaration.contentType, {
      [STAGED_NAME_METADATA_KEY]: encodeStagedName(
        declaration.name || "untitled",
      ),
    });

    const answer: MediaPresignResponse = {
      entryId: declaration.entryId,
      uploadUrl: upload.url,
      method: "PUT",
      headers: upload.headers,
      url: mediaUrl(key),
      // The same lifetime the URL was signed with, as an instant: a client
      // can tell a stale target from a live one instead of finding out at the
      // PUT. `uploadUrl` itself is never logged.
      expiresAt: new Date(
        Date.now() + PRESIGNED_PUT_TTL_SECONDS * 1000,
      ).toISOString(),
    };
    return c.json(answer);
  });

  // ------------------------------------------------------------------
  // Process: the authoritative check
  // ------------------------------------------------------------------
  r.post(`/${pop.population}/process`, requireSession, async (c) => {
    const catalogue = await requireMemberCatalogue(c, param(c, "catalogueId"));
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
      stagedOriginalPrefix(userId, catalogue.id, artworkId, entryId),
    );
    if (originals.length === 0) {
      throw new ApiError(
        "not-found",
        "The staged entry does not exist or has been discarded",
      );
    }
    const originalKey = originals[0];

    // The object's record first, then its bytes. A HEAD is cheap and answers
    // the two facts presign was only told — the stored content type and the
    // stored length — so an oversized or wrongly typed object is refused
    // before it is pulled into the function. The URL carries no signed length
    // (`content-length` is forbidden to `fetch`), so without this a forged
    // declaration buys a full download of whatever was PUT to the key.
    let head;
    try {
      head = await headObject(originalKey);
    } catch (err) {
      // The entry was listed a moment ago; a 404 here is a discard racing
      // this call, and the honest answer is the same not-found.
      if (isObjectMissing(err)) {
        throw new ApiError(
          "not-found",
          "The staged entry does not exist or has been discarded",
        );
      }
      throw err;
    }
    const storedType = head.ContentType ?? "";
    const storedLength = head.ContentLength ?? 0;
    const verdict = checkDeclaredUpload(kind, storedType, storedLength);
    if (verdict !== "allowed") {
      throw refusal(verdict);
    }

    const { bytes, metadata } = await readObject(originalKey);
    const name = decodeStagedName(metadata?.name);

    if (!isImage(storedType)) {
      // A PDF document has no variants: the original is the whole entry. Its
      // type and length were validated above, and its bytes are checked for
      // the PDF header here — process is the byte check even when there is
      // nothing to generate, so a text file declared as a PDF is refused
      // rather than promoted and later served from the app's own origin.
      if (!hasPdfSignature(bytes)) {
        throw invalid("The file could not be read", { file: "undecodable" });
      }
      const answer: MediaProcessResponse = {
        entryId,
        name,
        width: null,
        height: null,
        size: bytes.length,
        contentType: storedType,
        url: mediaUrl(originalKey),
        variants: [],
      };
      return c.json(answer);
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
        catalogue.id,
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
    const answer: MediaProcessResponse = {
      entryId,
      name,
      width: oriented.width,
      height: oriented.height,
      size: bytes.length,
      contentType: storedType,
      url: mediaUrl(originalKey),
      variants,
    };
    return c.json(answer);
  });

  // ------------------------------------------------------------------
  // Discard
  // ------------------------------------------------------------------
  r.delete(`/${pop.population}/:entryId`, requireSession, async (c) => {
    const catalogue = await requireMemberCatalogue(c, param(c, "catalogueId"));
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
      catalogue.id,
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
  const path = "/catalogues/:catalogueId/artworks/:artworkId";
  artworkMediaRoutes.route(path, routes);
}
