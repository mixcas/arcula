// The media fixtures: rows inserted straight through drizzle, and the staging
// hop that hangs off them.
//
// Catalogues and artworks go in through drizzle rather than the API — the
// routes that create them have their own suites, and these ones are about what
// happens to the media afterwards. The staging hop is the real one: a presign
// call, a direct `fetch` PUT to the URL it answered, and (where a suite needs
// measurements or variants) a process call — so a suite that stages is
// exercising the same three steps a browser does.

import sharp from "sharp";
import {
  artworks as artworksTable,
  catalogueInvitations as invitationsTable,
  catalogues as cataloguesTable,
} from "@arcula/db";
import type { CatalogueKind } from "@arcula/shared";
import { req, uuid } from "./api";
import { db } from "../../src/db";
import {
  INVITATION_TTL_MS,
  hashInvitationToken,
  mintInvitationToken,
} from "../../src/invitations";

export async function makeCatalogue(
  userId: string,
  opts: {
    isPublic?: boolean;
    name?: string;
    mediaNamespaceId?: string;
    /** The kind decides which surface reads the catalogue; the physical
     *  default is a Collection, as it is for a row written before the column. */
    kind?: CatalogueKind;
  } = {},
): Promise<string> {
  const id = uuid();
  await db.insert(cataloguesTable).values({
    id,
    userId,
    // Required since 0004. The default is the owner's id — the shape 0004's
    // backfill leaves on a pre-existing row, and the key segment the media
    // fixtures build against. A suite that needs the minted shape passes one.
    mediaNamespaceId: opts.mediaNamespaceId ?? userId,
    name: opts.name ?? "Test Catalogue",
    kind: opts.kind ?? "collection",
    isPublic: opts.isPublic ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

/** Insert `count` owned catalogues for `userId`, for a test that needs an
 *  account at or near its cap without spending API creates on setup. */
export async function seedCatalogues(
  userId: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await makeCatalogue(userId, { name: `Seed ${uuid()}`, isPublic: false });
  }
}

export async function makeArtwork(
  userId: string,
  catalogueId: string,
): Promise<string> {
  const id = uuid();
  await db.insert(artworksTable).values({
    id,
    userId,
    catalogueId,
    title: "Test Artwork",
    artistName: "Test Artist",
    status: "published",
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

// `Uint8Array.from` (not a view over Sharp's Buffer): File's BlobPart wants an
// ArrayBuffer-backed view.
export const makeJpeg = async (
  width = 400,
  height = 300,
  background = { r: 40, g: 90, b: 200 },
): Promise<Uint8Array<ArrayBuffer>> =>
  Uint8Array.from(
    (
      await sharp({
        create: { width, height, channels: 3, background },
      })
        .jpeg()
        .toBuffer({ resolveWithObject: true })
    ).data,
  );

type Population = "photos" | "documents";

/** The presign answer, as the wire carries it. */
export interface PresignedEntry {
  entryId: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  url: string;
  expiresAt: string;
}

/**
 * The presign call for one entry — the declaration half of the direct hop.
 *
 * The named wrappers below take a `File` because that is what the form has;
 * the tests that need to lie about a declaration (or PUT bytes the client
 * never had) call this directly.
 */
export async function presignEntry(
  population: Population,
  cookies: string,
  cid: string,
  aid: string,
  declaration: {
    entryId: string;
    contentType: string;
    size: number;
    name?: string;
  },
): Promise<Response> {
  return req(
    "POST",
    `/api/v1/catalogues/${cid}/artworks/${aid}/${population}/stage`,
    { cookies, body: JSON.stringify(declaration) },
  );
}

/**
 * The direct hop: a real `fetch` PUT of the file's bytes to the presigned URL
 * with exactly the headers the presign answered.
 *
 * This is the browser's half of the flow, and it goes over the network like
 * the browser's does — not through `app.request`, which would never prove the
 * URL is usable. `headers` may be overridden to forge what the stand-in lets
 * through (it does not verify signatures), which is how the process suite
 * seeds an object the declaration would have refused.
 */
export async function putEntry(
  upload: { uploadUrl: string; headers: Record<string, string> },
  bytes: Uint8Array<ArrayBuffer>,
  headers?: Record<string, string>,
): Promise<Response> {
  return fetch(upload.uploadUrl, {
    method: "PUT",
    headers: headers ?? upload.headers,
    body: bytes,
  });
}

/**
 * Stage one file against the route for `population`: presign, then the direct
 * PUT. The answer is the presign response, so a caller can assert `url` and
 * status the way the old multipart stage was asserted; callers that need the
 * measured metadata ask `processEntry`.
 */
export async function stageEntry(
  population: Population,
  cookies: string,
  cid: string,
  aid: string,
  entryId: string,
  file: File,
): Promise<Response> {
  const presign = await presignEntry(population, cookies, cid, aid, {
    entryId,
    contentType: file.type,
    size: file.size,
    name: file.name,
  });
  if (presign.status !== 200) return presign;
  // Clone before reading: the caller gets the response, and a consumed body
  // would make `json(staged)` in the suites a "body already used" failure.
  const upload = (await presign.clone().json()) as PresignedEntry;
  const put = await putEntry(upload, new Uint8Array(await file.arrayBuffer()));
  if (!put.ok) {
    throw new Error(`The direct PUT failed with ${put.status}`);
  }
  return presign;
}

export async function stagePhoto(
  cookies: string,
  cid: string,
  aid: string,
  entryId: string,
  file: File,
): Promise<Response> {
  return await stageEntry("photos", cookies, cid, aid, entryId, file);
}

export async function stageDocument(
  cookies: string,
  cid: string,
  aid: string,
  entryId: string,
  file: File,
): Promise<Response> {
  return await stageEntry("documents", cookies, cid, aid, entryId, file);
}

export async function processEntry(
  cookies: string,
  cid: string,
  aid: string,
  population: Population,
  body: string,
): Promise<Response> {
  return req(
    "POST",
    `/api/v1/catalogues/${cid}/artworks/${aid}/${population}/process`,
    {
      cookies,
      headers: { "Content-Type": "application/json" },
      body,
    },
  );
}

export async function discardEntry(
  cookies: string,
  cid: string,
  aid: string,
  population: Population,
  entryId: string,
): Promise<Response> {
  return req(
    "DELETE",
    `/api/v1/catalogues/${cid}/artworks/${aid}/${population}/${entryId}`,
    {
      cookies,
    },
  );
}

/**
 * An invitation row written straight through drizzle, for the states the
 * create route cannot produce on demand (expired, revoked, backdated) and for
 * an address no account owns yet.
 */
export async function makeInvitation(opts: {
  catalogueId: string;
  invitedByUserId: string;
  email: string;
  status?: "pending" | "accepted" | "declined" | "revoked";
  token?: string;
  createdAt?: Date;
  expiresAt?: Date;
  /** Store the address exactly as given instead of normalized: the row a
   *  hand-written seed or a pre-normalization import could hold, for the
   *  case-insensitive checks. */
  storeEmailAsGiven?: boolean;
}): Promise<{ id: string; token: string }> {
  const id = uuid();
  const token = opts.token ?? mintInvitationToken();
  const createdAt = opts.createdAt ?? new Date();
  const status = opts.status ?? "pending";
  await db.insert(invitationsTable).values({
    id,
    catalogueId: opts.catalogueId,
    email: opts.storeEmailAsGiven
      ? opts.email
      : opts.email.trim().toLowerCase(),
    invitedByUserId: opts.invitedByUserId,
    tokenHash: hashInvitationToken(token),
    status,
    createdAt,
    expiresAt:
      opts.expiresAt ?? new Date(createdAt.getTime() + INVITATION_TTL_MS),
    resolvedAt: status === "pending" ? null : createdAt,
  });
  return { id, token };
}
