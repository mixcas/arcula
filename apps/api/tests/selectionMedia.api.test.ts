// The media proxy's Selection scope, against the real stack.
//
// The headline case is a **Draft**, not a Published work: the Catalogue verdict
// already admits a published work in a public Catalogue, so a test built on one
// would pass without the scope at all. A Draft's photo is 404 without
// `&selection=`, and 200 through a Selection that admits this reader.
//
// The scope is a second gate, not a widening of the first: a private Selection
// is 404, a protected one without its grant is 404, another Catalogue's
// Selection is 404, a work with no curation row is 404, and a work deleted in
// its Catalogue is 404 even though its `selection_works` row survives (the row
// is kept on purpose, so a restore rejoins). Documents ignore the scope
// entirely and stay 403 to everyone but a member.
//
// Every admitted selection-scoped response is cached `private`, including one
// the Catalogue verdict would have admitted on its own: the right to the bytes
// is bounded by a Selection state the curator can change.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Selection } from "@arcula/shared";
import { artworks as artworksTable } from "@arcula/db";
import { closeDb, db } from "../src/db";
import { finalDocumentKey, finalPhotoKey, mediaUrl } from "../src/media/keys";
import { err, freshUser, json, req, sessionCookies, uuid } from "./helpers/api";
import {
  makeCatalogue,
  makeJpeg,
  processEntry,
  stageEntry,
} from "./helpers/fixtures";

const RUN = Math.random().toString(36).slice(2, 10);
const entry = (label: string): string => `${label.replace(/-/g, "")}${RUN}`;

const pDraft = entry("sel-draft-photo");
const pPub = entry("sel-pub-photo");
const pGone = entry("sel-gone-photo");
const pOutside = entry("sel-outside-photo");
const pPrivate = entry("sel-private-photo");
const dDraft = entry("sel-draft-doc");

const PASSWORD = "open-sesame";

let owner: { cookies: string; userId: string };
let stranger: { cookies: string; userId: string };

/** A public Catalogue: its published works are the Catalogue verdict's own. */
let cid = "";
/** A private Catalogue: only the Selection's verdict can admit its bytes. */
let privCid = "";

let draftWorkId = "";
let pubWorkId = "";
let goneWorkId = "";
let outsideWorkId = "";
let privateWorkId = "";

let openSelection: Selection;
let privateSelection: Selection;
let protectedSelection: Selection;
let foreignSelection: Selection;

const selectionsPath = (catalogueId: string) =>
  `/api/v1/catalogues/${catalogueId}/selections`;

const selectionPath = (catalogueId: string, selectionId: string) =>
  `${selectionsPath(catalogueId)}/${selectionId}`;

async function stage(
  catalogueId: string,
  population: "photos" | "documents",
  artworkId: string,
  entryId: string,
  file: File,
): Promise<void> {
  const staged = await stageEntry(
    population,
    owner.cookies,
    catalogueId,
    artworkId,
    entryId,
    file,
  );
  expect(staged.status).toBe(200);
  const processed = await processEntry(
    owner.cookies,
    catalogueId,
    artworkId,
    population,
    JSON.stringify({ entryId }),
  );
  expect(processed.status).toBe(200);
}

const jpeg = (name: string) =>
  makeJpeg().then((bytes) => {
    return new File([bytes], name, { type: "image/jpeg" });
  });

const pdf = () =>
  new File(
    [Uint8Array.from(new TextEncoder().encode("%PDF-1.4 (test) %%EOF"))],
    "cert.pdf",
    {
      type: "application/pdf",
    },
  );

async function createWork(
  catalogueId: string,
  artworkId: string,
  title: string,
  opts: {
    status?: "draft" | "published";
    photos?: { entryId: string; name: string }[];
    documents?: { entryId: string; name: string }[];
  } = {},
): Promise<void> {
  const res = await req("POST", `/api/v1/catalogues/${catalogueId}/artworks`, {
    cookies: owner.cookies,
    body: {
      artworkId,
      title,
      artistName: "C. Cas",
      status: opts.status ?? "published",
      photos: opts.photos ?? [],
      documents: opts.documents ?? [],
    },
  });
  expect(res.status).toBe(201);
}

async function makeSelection(
  catalogueId: string,
  name: string,
  artworkIds: string[],
  opts: { isPublic?: boolean; password?: string } = {},
): Promise<Selection> {
  const created = await req("POST", selectionsPath(catalogueId), {
    cookies: owner.cookies,
    body: { name },
  });
  expect(created.status).toBe(201);
  const selection = await json<Selection>(created);

  const added = await req(
    "POST",
    `${selectionPath(catalogueId, selection.id)}/works`,
    { cookies: owner.cookies, body: { artworkIds } },
  );
  expect(added.status).toBe(200);

  const patch: Record<string, unknown> = {};
  if (opts.isPublic !== undefined) patch.isPublic = opts.isPublic;
  if (opts.password !== undefined) patch.password = opts.password;
  if (Object.keys(patch).length > 0) {
    const patched = await req(
      "PATCH",
      selectionPath(catalogueId, selection.id),
      { cookies: owner.cookies, body: patch },
    );
    expect(patched.status).toBe(200);
  }
  return selection;
}

const photoKey = (catalogueId: string, artworkId: string, entryId: string) =>
  finalPhotoKey(
    owner.userId,
    catalogueId,
    artworkId,
    entryId,
    "original",
    "jpg",
  );

/** A media request: the key, and the Selection scope when one is given. */
const get = (key: string, selectionId?: string, cookies?: string) =>
  req(
    "GET",
    mediaUrl(key, selectionId),
    cookies === undefined ? {} : { cookies },
  );

beforeAll(async () => {
  owner = await freshUser("SelMediaOwner");
  stranger = await freshUser("SelMediaOther");

  cid = await makeCatalogue(owner.userId, {
    isPublic: true,
    name: "Selection Media Wall",
  });
  privCid = await makeCatalogue(owner.userId, {
    isPublic: false,
    name: "Selection Media Private",
  });

  // A draft with a photo and a document: the feature's headline case, and the
  // documents rule proved at a status the Catalogue itself hides.
  draftWorkId = uuid();
  await stage(cid, "photos", draftWorkId, pDraft, await jpeg("draft.jpg"));
  await stage(cid, "documents", draftWorkId, dDraft, pdf());
  await createWork(cid, draftWorkId, "Draft Work", {
    status: "draft",
    photos: [{ entryId: pDraft, name: "draft.jpg" }],
    documents: [{ entryId: dDraft, name: "cert.pdf" }],
  });

  // A published work in the public Catalogue: the Catalogue verdict admits it,
  // which is what proves the cache header is about the scope, not the gate.
  pubWorkId = uuid();
  await stage(cid, "photos", pubWorkId, pPub, await jpeg("pub.jpg"));
  await createWork(cid, pubWorkId, "Published Work", {
    photos: [{ entryId: pPub, name: "pub.jpg" }],
  });

  // A published work that is deleted after curation: the row survives, the
  // bytes must not.
  goneWorkId = uuid();
  await stage(cid, "photos", goneWorkId, pGone, await jpeg("gone.jpg"));
  await createWork(cid, goneWorkId, "Gone Work", {
    photos: [{ entryId: pGone, name: "gone.jpg" }],
  });

  // A draft the Selection never names.
  outsideWorkId = uuid();
  await stage(cid, "photos", outsideWorkId, pOutside, await jpeg("out.jpg"));
  await createWork(cid, outsideWorkId, "Outside Work", {
    status: "draft",
    photos: [{ entryId: pOutside, name: "out.jpg" }],
  });

  // A draft inside the private Catalogue: the Selection's verdict is the only
  // thing that can admit it — the source Catalogue's visibility is inert.
  privateWorkId = uuid();
  await stage(
    privCid,
    "photos",
    privateWorkId,
    pPrivate,
    await jpeg("priv.jpg"),
  );
  await createWork(privCid, privateWorkId, "Private Wall Draft", {
    status: "draft",
    photos: [{ entryId: pPrivate, name: "priv.jpg" }],
  });

  openSelection = await makeSelection(
    cid,
    "Open Shortlist",
    [draftWorkId, pubWorkId, goneWorkId],
    { isPublic: true },
  );
  privateSelection = await makeSelection(cid, "Private Shortlist", [
    draftWorkId,
  ]);
  protectedSelection = await makeSelection(
    cid,
    "Protected Shortlist",
    [draftWorkId],
    { isPublic: true, password: PASSWORD },
  );
  foreignSelection = await makeSelection(
    privCid,
    "Other Wall Shortlist",
    [privateWorkId],
    { isPublic: true },
  );

  // Deleted after it was curated: the `selection_works` row stays.
  await db
    .update(artworksTable)
    .set({ deletedAt: new Date() })
    .where(eq(artworksTable.id, goneWorkId));
});

afterAll(closeDb);

describe("GET /api/v1/media?selection= — a Draft in a Selection", () => {
  it("is 404 without the scope and 200 with it, cached privately", async () => {
    const key = photoKey(cid, draftWorkId, pDraft);

    // The Catalogue's own verdict refuses a visitor a Draft. That is the
    // stopping point this scope exists to pass.
    expect((await get(key)).status).toBe(404);
    expect((await get(key, undefined, stranger.cookies)).status).toBe(404);

    const scoped = await get(key, openSelection.id);
    expect(scoped.status).toBe(200);
    expect(scoped.headers.get("Content-Type")).toBe("image/jpeg");
    expect(scoped.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });

  it("admits the source Catalogue's own draft through a public Selection", async () => {
    // A Private Catalogue's work: only the Selection's audience asked.
    const key = photoKey(privCid, privateWorkId, pPrivate);
    expect((await get(key)).status).toBe(404);

    const scoped = await get(key, foreignSelection.id);
    expect(scoped.status).toBe(200);
    expect(scoped.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });

  it("refuses a private Selection's scope", async () => {
    const key = photoKey(cid, draftWorkId, pDraft);
    expect((await get(key, privateSelection.id)).status).toBe(404);
    expect((await get(key, privateSelection.id, stranger.cookies)).status).toBe(
      404,
    );
  });

  it("refuses a protected Selection's scope without its grant, and admits it with one", async () => {
    const key = photoKey(cid, draftWorkId, pDraft);
    expect((await get(key, protectedSelection.id)).status).toBe(404);

    const unlocked = await req(
      "POST",
      `/api/v1/selections/${protectedSelection.id}/unlock`,
      { body: { password: PASSWORD } },
    );
    expect(unlocked.status).toBe(201);

    const admitted = await get(
      key,
      protectedSelection.id,
      sessionCookies(unlocked),
    );
    expect(admitted.status).toBe(200);
    expect(admitted.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });

  it("refuses a work with no curation row even when the Selection is readable", async () => {
    const key = photoKey(cid, outsideWorkId, pOutside);
    expect((await get(key, openSelection.id)).status).toBe(404);
  });

  it("refuses a Selection belonging to another Catalogue", async () => {
    const key = photoKey(cid, draftWorkId, pDraft);
    // foreignSelection is public and readable, but its source Catalogue is
    // privCid: it says nothing about this key's works.
    expect((await get(key, foreignSelection.id)).status).toBe(404);
  });

  it("refuses a deleted work even though its curation row survives", async () => {
    const key = photoKey(cid, goneWorkId, pGone);
    expect((await get(key, openSelection.id)).status).toBe(404);
    const body = await err(await get(key, openSelection.id));
    expect(body.code).toBe("not-found");
  });

  it("answers not-found for an unparseable selection id on a refused photo", async () => {
    const key = photoKey(cid, draftWorkId, pDraft);
    expect((await get(key, "not-a-selection")).status).toBe(404);
  });
});

describe("GET /api/v1/media?selection= — documents", () => {
  it("stays 403 for a visitor with the scope, and 200 for a member", async () => {
    const key = finalDocumentKey(
      owner.userId,
      cid,
      draftWorkId,
      dDraft,
      "original",
      "pdf",
    );
    expect((await get(key, openSelection.id)).status).toBe(403);
    expect((await get(key, openSelection.id, stranger.cookies)).status).toBe(
      403,
    );
    // The scope changes nothing for a member either: the document is theirs.
    const own = await get(key, openSelection.id, owner.cookies);
    expect(own.status).toBe(200);
    expect(own.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });
});

describe("GET /api/v1/media?selection= — the cache header", () => {
  it("is private on a selection-scoped URL even when the Catalogue admits the photo", async () => {
    const key = photoKey(cid, pubWorkId, pPub);

    // Public without the scope: the same bytes, the same answer to anyone.
    const open = await get(key);
    expect(open.status).toBe(200);
    expect(open.headers.get("Cache-Control")).toBe("public, max-age=3600");

    // Scoped, the URL's right to the bytes is the Selection's. Even though the
    // gate that let it through was the Catalogue's, it must never be shared.
    const scoped = await get(key, openSelection.id);
    expect(scoped.status).toBe(200);
    expect(scoped.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });

  it("is private for a bad or irrelevant selection param on an admitted photo", async () => {
    const key = photoKey(cid, pubWorkId, pPub);
    // The Catalogue verdict is the gate; the scope is only a cache fact here.
    // A URL carrying a scope it does not honour must still not be shared.
    for (const scope of ["doesnotexist1234567890", foreignSelection.id]) {
      const res = await get(key, scope);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    }
  });
});
