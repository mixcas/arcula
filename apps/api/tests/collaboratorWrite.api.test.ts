// A collaborator does the job they were invited to do, end to end: one
// collection created by its owner and shared with a second account, driven
// through the real write routes against the real stack.
//
// This is the wire proof that every write path answers to membership rather
// than to `collections.userId`. The settings — public/private included — the
// artwork create, edit, bulk-delete and restore, the CSV import, the save and
// the staged media all belong to a collaborator exactly as they do to the
// owner; a stranger gets `403` and a missing collection `404`.
//
// Two facts are about the collaborator specifically, not just about the route
// admitting them:
//
//   - **Staging stays per uploader.** A staged object is named by the account
//     that uploaded it, so process, discard and the sweep only ever reach the
//     caller's own unsaved work: one person's sweep cannot destroy another's.
//   - **A save records the collection's owner.** The final objects land under
//     the collection's fixed media namespace and `artworks.userId` mirrors the
//     owner, not the session user — the collaborator saves work, they do not
//     become its owner.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  collectionCollaborators as collaboratorsTable,
  collections as collectionsTable,
} from "@arcula/db";
import type { ArtworkRead, Collection } from "@arcula/shared";
import { closeDb, db } from "../src/db";
import {
  finalPhotoPrefix,
  parseMediaKey,
  stagedOriginalPrefix,
} from "../src/media/keys";
import { listObjects } from "../src/storage";
import { err, freshUser, json, req, uuid } from "./helpers/api";
import {
  discardEntry,
  makeJpeg,
  processEntry,
  stageDocument,
  stagePhoto,
} from "./helpers/fixtures";

// Entry ids are global primary keys, and the stack persists across runs: each
// run gets its own id namespace, exactly as save.api.test.ts does.
const RUN = Math.random().toString(36).slice(2, 10);
const entry = (label: string): string => `${label}-${RUN}`;

type Account = { cookies: string; userId: string };

let owner: Account;
let mate: Account;
let stranger: Account;

/** The shared collection: created by the owner, shared with `mate`. */
let cid = "";
/** Its fixed media namespace — minted at creation, and neither account's id. */
let namespace = "";

/** Sign up an account and share a collection with it. */
async function share(
  label: string,
  collectionId: string = cid,
): Promise<Account> {
  const account = await freshUser(label);
  await db.insert(collaboratorsTable).values({
    collectionId,
    userId: account.userId,
  });
  return account;
}

beforeAll(async () => {
  owner = await freshUser("WriteOwner");
  stranger = await freshUser("WriteOther");

  // Created through the route, so the collection carries the media namespace
  // the current code mints — the fact the save's final keys are checked against.
  const created = await req("POST", "/api/v1/collections", {
    cookies: owner.cookies,
    body: { name: "Shared Wall", isPublic: false },
  });
  expect(created.status).toBe(201);
  cid = (await json<Collection>(created)).id;

  const [row] = await db
    .select()
    .from(collectionsTable)
    .where(eq(collectionsTable.id, cid));
  namespace = row.mediaNamespaceId;

  mate = await share("WriteMate");
});

afterAll(async () => {
  await closeDb();
});

const collectionPath = (id = cid) => `/api/v1/collections/${id}`;
const listPath = (id = cid) => `${collectionPath(id)}/artworks`;

async function listAs(cookies: string, id = cid): Promise<ArtworkRead[]> {
  const res = await req("GET", listPath(id), { cookies });
  expect(res.status).toBe(200);
  return await json<ArtworkRead[]>(res);
}

/** The object key a proxy URL names. */
function keyOf(url: string): string {
  const key = new URL(url, "http://localhost").searchParams.get("key");
  if (key === null) throw new Error(`The URL names no object key: ${url}`);
  return key;
}

/** Stage one photo as `account` and run its pipeline: one ready entry. */
async function stageAndProcessPhoto(
  account: Account,
  id: string,
  aid: string,
  entryId: string,
): Promise<void> {
  const staged = await stagePhoto(
    account.cookies,
    id,
    aid,
    entryId,
    new File([await makeJpeg()], "scan.jpg", { type: "image/jpeg" }),
  );
  expect(staged.status).toBe(200);
  const processed = await processEntry(
    account.cookies,
    id,
    aid,
    "photos",
    JSON.stringify({ entryId }),
  );
  expect(processed.status).toBe(200);
}

// ---------------------------------------------------------------------------
// The settings
// ---------------------------------------------------------------------------

describe("PATCH /collections/:collectionId — the settings", () => {
  it("lets a collaborator change every setting, public/private included", async () => {
    const res = await req("PATCH", collectionPath(), {
      cookies: mate.cookies,
      body: {
        name: "Edited By A Collaborator",
        isPublic: true,
        description: "About the wall",
        skin: "basicx",
        skinOptions: { transitionSeconds: 2 },
      },
    });
    expect(res.status).toBe(200);
    const body = await json<Collection>(res);
    expect(body).toMatchObject({
      name: "Edited By A Collaborator",
      isPublic: true,
      description: "About the wall",
      skin: "basicx",
      skinOptions: { transitionSeconds: 2 },
    });

    // The gate is the whole point of "every setting": a collaborator who could
    // not publish could not do the job they were invited to do.
    const anon = await req("GET", collectionPath());
    expect(anon.status).toBe(200);

    // …and back to private, by the same account.
    const closed = await req("PATCH", collectionPath(), {
      cookies: mate.cookies,
      body: { name: "Shared Wall", isPublic: false },
    });
    expect(closed.status).toBe(200);
    const reopened = await req("GET", collectionPath());
    expect(reopened.status).toBe(403);
  });

  it("does not move the owner column", async () => {
    // Settings are not ownership: the owner still owns, the collaborator is
    // still a collaborator.
    const ownerList = await json<Collection[]>(
      await req("GET", "/api/v1/collections", { cookies: owner.cookies }),
    );
    expect(ownerList.find((c) => c.id === cid)?.role).toBe("owner");

    const mateList = await json<Collection[]>(
      await req("GET", "/api/v1/collections", { cookies: mate.cookies }),
    );
    expect(mateList.find((c) => c.id === cid)?.role).toBe("collaborator");
  });
});

// ---------------------------------------------------------------------------
// Create and save
// ---------------------------------------------------------------------------

describe("POST …/artworks — a collaborator's save", () => {
  it("creates the work, mirrors the owner and keys the objects by the namespace", async () => {
    const aid = uuid();
    const p = entry("cw-create");
    await stageAndProcessPhoto(mate, cid, aid, p);

    const res = await req("POST", listPath(), {
      cookies: mate.cookies,
      body: {
        artworkId: aid,
        title: "Their Work",
        artistName: "C. Cas",
        status: "draft",
        photos: [{ entryId: p, name: "scan.jpg" }],
      },
    });
    expect(res.status).toBe(201);
    const body = await json<ArtworkRead>(res);

    // The mirror: the collection's owner, never the session user.
    expect(body.userId).toBe(owner.userId);
    expect(namespace).not.toBe(mate.userId);

    // The final objects belong to the collection, not to whoever uploaded
    // them: the namespace is the key's segment.
    const parsed = parseMediaKey(keyOf(body.photos[0].original.url));
    expect(parsed).toMatchObject({
      kind: "final",
      namespaceId: namespace,
      collectionId: cid,
      artworkId: aid,
    });
    expect(
      await listObjects(finalPhotoPrefix(namespace, cid, aid, p)),
    ).toHaveLength(6);
    // …and the uploader's staged objects are gone, as any save's are.
    expect(
      await listObjects(stagedOriginalPrefix(mate.userId, cid, aid, p)),
    ).toEqual([]);
  });

  it("reads the saved draft back to the collaborator", async () => {
    const aid = uuid();
    const p = entry("cw-readback");
    await stageAndProcessPhoto(mate, cid, aid, p);
    const saved = await req("POST", listPath(), {
      cookies: mate.cookies,
      body: {
        artworkId: aid,
        title: "Saved In Draft",
        artistName: "C. Cas",
        status: "draft",
        photos: [{ entryId: p, name: "scan.jpg" }],
      },
    });
    expect(saved.status).toBe(201);
    const document = await json<ArtworkRead>(saved);

    // The read-back is the collaborator's: the save answered without 404ing
    // on them, and a read of the same work agrees with it.
    const read = await req("GET", `${listPath()}/${aid}`, {
      cookies: mate.cookies,
    });
    expect(read.status).toBe(200);
    expect(await json<ArtworkRead>(read)).toEqual(document);

    // And it is in the collection's list for every member, the owner too.
    for (const account of [owner, mate]) {
      expect((await listAs(account.cookies)).map((w) => w.id)).toContain(aid);
    }
  });
});

// ---------------------------------------------------------------------------
// Edit, bulk delete, restore and import
// ---------------------------------------------------------------------------

/** Create a work through the route, asserting the save landed. */
async function createWork(
  account: Account,
  body: Record<string, unknown>,
  id: string = cid,
): Promise<ArtworkRead> {
  const res = await req("POST", listPath(id), {
    cookies: account.cookies,
    body,
  });
  expect(res.status).toBe(201);
  return await json<ArtworkRead>(res);
}

describe("PATCH …/artworks/{aid} — a collaborator's edit", () => {
  it("edits the fields, publishes a draft and adds a photo of their own", async () => {
    const aid = uuid();
    await createWork(mate, {
      artworkId: aid,
      title: "A Draft",
      artistName: "C. Cas",
      status: "draft",
    });

    const extra = entry("cw-edit");
    await stageAndProcessPhoto(mate, cid, aid, extra);
    const res = await req("PATCH", `${listPath()}/${aid}`, {
      cookies: mate.cookies,
      body: {
        title: "A Published Work",
        artistName: "C. Cas",
        status: "published",
        serie: "Late works",
        photos: [{ entryId: extra, name: "scan.jpg" }],
      },
    });
    expect(res.status).toBe(200);
    const body = await json<ArtworkRead>(res);
    expect(body).toMatchObject({
      title: "A Published Work",
      status: "published",
      serie: "Late works",
    });
    expect(body.photos.map((p) => p.id)).toEqual([extra]);
    // An edit never moves the work to the editor: the owner column is not
    // writable from the session.
    expect(body.userId).toBe(owner.userId);
    expect(
      await listObjects(finalPhotoPrefix(namespace, cid, aid, extra)),
    ).toHaveLength(6);
  });

  it("answers an edit of a tombstoned work, so a restore path can show it", async () => {
    const aid = uuid();
    await createWork(mate, {
      artworkId: aid,
      title: "Deleted Then Edited",
      artistName: "C. Cas",
    });
    const deleted = await req("POST", `${listPath()}/bulk-delete`, {
      cookies: mate.cookies,
      body: { artworkIds: [aid] },
    });
    expect(deleted.status).toBe(200);

    const res = await req("PATCH", `${listPath()}/${aid}`, {
      cookies: mate.cookies,
      body: { title: "Deleted Then Edited", artistName: "C. Cas" },
    });
    expect(res.status).toBe(200);
    expect((await json<ArtworkRead>(res)).deletedAt).not.toBeNull();
  });
});

describe("bulk-delete and restore", () => {
  it("lets a collaborator tombstone a work and bring it back", async () => {
    const aid = uuid();
    await createWork(mate, {
      artworkId: aid,
      title: "To Be Deleted",
      artistName: "C. Cas",
    });

    const deleted = await req("POST", `${listPath()}/bulk-delete`, {
      cookies: mate.cookies,
      body: { artworkIds: [aid] },
    });
    expect(deleted.status).toBe(200);
    expect(await json(deleted)).toEqual({ deleted: 1 });

    // Gone from every member's list, still readable by every member.
    for (const account of [owner, mate]) {
      expect((await listAs(account.cookies)).map((w) => w.id)).not.toContain(
        aid,
      );
      const read = await req("GET", `${listPath()}/${aid}`, {
        cookies: account.cookies,
      });
      expect(read.status).toBe(200);
      expect((await json<ArtworkRead>(read)).deletedAt).not.toBeNull();
    }

    const restored = await req("POST", `${listPath()}/${aid}/restore`, {
      cookies: mate.cookies,
    });
    expect(restored.status).toBe(200);
    expect(await json(restored)).toEqual({ restored: true });
    expect((await listAs(mate.cookies)).map((w) => w.id)).toContain(aid);
  });
});

describe("POST …/import/csv", () => {
  it("imports rows as the collection's works, recorded as the owner's", async () => {
    const res = await req("POST", `${collectionPath()}/import/csv`, {
      cookies: mate.cookies,
      body: {
        rows: [
          { title: "Imported By A Collaborator", artistName: "C. Cas" },
          { artistName: "No Title" },
        ],
      },
    });
    expect(res.status).toBe(200);
    const outcome = await json<{
      inserted: number;
      rejected: { row: number }[];
    }>(res);
    expect(outcome.inserted).toBe(1);
    expect(outcome.rejected.map((r) => r.row)).toEqual([1]);

    const imported = (await listAs(mate.cookies)).find(
      (w) => w.title === "Imported By A Collaborator",
    );
    if (!imported) throw new Error("The imported work is not in the list");
    // The same mirror a save writes: the import adds the collection's works,
    // whoever ran it.
    expect(imported.userId).toBe(owner.userId);
    expect(imported.status).toBe("published");
  });
});

// ---------------------------------------------------------------------------
// Staged media: per uploader, whoever the caller is
// ---------------------------------------------------------------------------

describe("staging as a collaborator", () => {
  it("stages, processes and discards a photo and a document", async () => {
    const aid = uuid();
    const photo = entry("cw-stage-p");
    const doc = entry("cw-stage-d");

    await stageAndProcessPhoto(mate, cid, aid, photo);
    // The staged key names the uploader: staging is per account, not per
    // collection, and the collaborator is the uploader here.
    expect(
      await listObjects(stagedOriginalPrefix(mate.userId, cid, aid, photo)),
    ).toHaveLength(1);

    // A PDF has no variants; process is still the collaborator's to call.
    const pdf = new Uint8Array([
      ...[0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], // %PDF-1.4
      ...Array.from({ length: 64 }, () => 0),
    ]);
    const stagedDoc = await stageDocument(
      mate.cookies,
      cid,
      aid,
      doc,
      new File([pdf], "report.pdf", { type: "application/pdf" }),
    );
    expect(stagedDoc.status).toBe(200);
    const processed = await processEntry(
      mate.cookies,
      cid,
      aid,
      "documents",
      JSON.stringify({ entryId: doc }),
    );
    expect(processed.status).toBe(200);
    expect((await json<{ variants: unknown[] }>(processed)).variants).toEqual(
      [],
    );

    // Discard takes the entry's objects — the original plus its variants.
    const discarded = await discardEntry(
      mate.cookies,
      cid,
      aid,
      "photos",
      photo,
    );
    expect(discarded.status).toBe(200);
    expect((await json<{ deleted: number }>(discarded)).deleted).toBe(6);
    expect(
      await listObjects(stagedOriginalPrefix(mate.userId, cid, aid, photo)),
    ).toEqual([]);

    const discardedDoc = await discardEntry(
      mate.cookies,
      cid,
      aid,
      "documents",
      doc,
    );
    expect((await json<{ deleted: number }>(discardedDoc)).deleted).toBe(1);
  });

  it("never reaches another member's staged entry", async () => {
    const aid = uuid();
    const stagedByMate = entry("cw-mine");
    const stagedByOwner = entry("cw-theirs");
    await stageAndProcessPhoto(mate, cid, aid, stagedByMate);
    await stageAndProcessPhoto(owner, cid, aid, stagedByOwner);

    // The owner cannot process the collaborator's entry: process reads the
    // caller's own staging prefix, where nothing exists.
    const foreignProcess = await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: stagedByMate }),
    );
    expect(foreignProcess.status).toBe(404);
    expect((await err(foreignProcess)).code).toBe("not-found");

    // …nor discard it. Idempotent, so the answer is "nothing was removed"
    // rather than an error — and the collaborator's unsaved upload survives.
    const foreignDiscard = await discardEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      stagedByMate,
    );
    expect(foreignDiscard.status).toBe(200);
    expect((await json<{ deleted: number }>(foreignDiscard)).deleted).toBe(0);

    // The other direction too: the prefix is the caller's, not the owner's.
    const otherDiscard = await discardEntry(
      mate.cookies,
      cid,
      aid,
      "photos",
      stagedByOwner,
    );
    expect((await json<{ deleted: number }>(otherDiscard)).deleted).toBe(0);

    for (const [account, staged] of [
      [mate, stagedByMate],
      [owner, stagedByOwner],
    ] as const) {
      expect(
        await listObjects(
          stagedOriginalPrefix(account.userId, cid, aid, staged),
        ),
      ).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// The sweep: one account's cleanup is not another's
// ---------------------------------------------------------------------------

describe("POST …/maintenance/sweep", () => {
  it("sweeps only the caller's staged objects, and keeps an entry that has a row", async () => {
    // A collection of its own and an owner of its own — the free tier allows
    // one owned collection per account — so the counts below are exact.
    const sweepOwner = await freshUser("WriteSweepOwner");
    const created = await req("POST", "/api/v1/collections", {
      cookies: sweepOwner.cookies,
      body: { name: "Swept Wall" },
    });
    expect(created.status).toBe(201);
    const sweptCid = (await json<Collection>(created)).id;
    const sweptMate = await share("WriteSweepMate", sweptCid);

    const unsavedArt = uuid();
    const mateOrphan = entry("cw-sweep-mate");
    const ownerOrphan = entry("cw-sweep-owner");
    await stageAndProcessPhoto(sweptMate, sweptCid, unsavedArt, mateOrphan);
    await stageAndProcessPhoto(sweepOwner, sweptCid, unsavedArt, ownerOrphan);

    // An entry that HAS a row: saved first, then re-staged — the staged
    // object is then the newest version of a saved entry, and the row is
    // what a restore would point at.
    const savedArt = uuid();
    const savedEntry = entry("cw-sweep-saved");
    await stageAndProcessPhoto(sweptMate, sweptCid, savedArt, savedEntry);
    await createWork(
      sweptMate,
      {
        artworkId: savedArt,
        title: "Saved Then Restaged",
        artistName: "C. Cas",
        photos: [{ entryId: savedEntry, name: "scan.jpg" }],
      },
      sweptCid,
    );
    await stageAndProcessPhoto(sweptMate, sweptCid, savedArt, savedEntry);

    // The collaborator's sweep: their own orphan goes, the owner's unsaved
    // upload stays, and the saved entry's staged copy stays.
    const res = await req(
      "POST",
      `${collectionPath(sweptCid)}/maintenance/sweep`,
      { cookies: sweptMate.cookies },
    );
    expect(res.status).toBe(200);
    // The orphan's original and five variants; nothing else.
    expect(await json(res)).toEqual({ swept: 6 });
    expect(
      await listObjects(
        stagedOriginalPrefix(
          sweptMate.userId,
          sweptCid,
          unsavedArt,
          mateOrphan,
        ),
      ),
    ).toEqual([]);
    expect(
      await listObjects(
        stagedOriginalPrefix(
          sweepOwner.userId,
          sweptCid,
          unsavedArt,
          ownerOrphan,
        ),
      ),
    ).toHaveLength(1);
    expect(
      await listObjects(
        stagedOriginalPrefix(sweptMate.userId, sweptCid, savedArt, savedEntry),
      ),
    ).toHaveLength(1);

    // The owner's sweep takes their own orphan — and stops at the
    // collaborator's space.
    const ownerSweep = await req(
      "POST",
      `${collectionPath(sweptCid)}/maintenance/sweep`,
      { cookies: sweepOwner.cookies },
    );
    expect(await json(ownerSweep)).toEqual({ swept: 6 });
    expect(
      await listObjects(
        stagedOriginalPrefix(sweptMate.userId, sweptCid, savedArt, savedEntry),
      ),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Who may write: one answer over every write route
// ---------------------------------------------------------------------------

/**
 * The named write routes, as a call taking the caller's cookies and a
 * collection id. The document stage/process routes are not listed: they are
 * the photo routes' twins through `buildMediaRoutes`, so a separate entry
 * would prove only the shared code again. A route missing from this table is
 * a route nobody has proved answers to membership, so the list grows with the
 * surface.
 */
const writeRoutes: {
  label: string;
  call: (cookies: string, id: string) => Promise<Response>;
}[] = [
  {
    label: "PATCH the settings",
    call: (cookies, id) =>
      req("PATCH", collectionPath(id), {
        cookies,
        body: { name: "Hijacked", isPublic: true },
      }),
  },
  {
    label: "create a work",
    call: (cookies, id) =>
      req("POST", listPath(id), {
        cookies,
        body: { artworkId: uuid(), title: "T", artistName: "C. Cas" },
      }),
  },
  {
    label: "edit a work",
    call: (cookies, id) =>
      req("PATCH", `${listPath(id)}/${uuid()}`, {
        cookies,
        body: { title: "T", artistName: "C. Cas" },
      }),
  },
  {
    label: "import CSV",
    call: (cookies, id) =>
      req("POST", `${collectionPath(id)}/import/csv`, {
        cookies,
        body: { rows: [{ title: "T", artistName: "C. Cas" }] },
      }),
  },
  {
    label: "bulk-delete",
    call: (cookies, id) =>
      req("POST", `${listPath(id)}/bulk-delete`, {
        cookies,
        body: { artworkIds: [uuid()] },
      }),
  },
  {
    label: "restore",
    call: (cookies, id) =>
      req("POST", `${listPath(id)}/${uuid()}/restore`, { cookies }),
  },
  {
    label: "sweep",
    call: (cookies, id) =>
      req("POST", `${collectionPath(id)}/maintenance/sweep`, { cookies }),
  },
  {
    label: "stage a photo",
    call: async (cookies, id) =>
      await stagePhoto(
        cookies,
        id,
        uuid(),
        entry("cw-nobody"),
        new File([await makeJpeg()], "scan.jpg", { type: "image/jpeg" }),
      ),
  },
  {
    label: "process a photo",
    call: (cookies, id) =>
      processEntry(
        cookies,
        id,
        uuid(),
        "photos",
        JSON.stringify({ entryId: entry("cw-nobody") }),
      ),
  },
  {
    label: "discard a photo",
    call: (cookies, id) =>
      discardEntry(cookies, id, uuid(), "photos", entry("cw-nobody")),
  },
];

describe("who may write", () => {
  it.each(writeRoutes)("403s a non-member on $label", async ({ call }) => {
    const res = await call(stranger.cookies, cid);
    expect(res.status).toBe(403);
    expect((await err(res)).code).toBe("forbidden");
  });

  it.each(writeRoutes)(
    "404s a missing collection on $label",
    async ({ call }) => {
      // The collection is asked for before the membership: a collection that
      // does not exist is `404` for the owner too, not a `403`.
      const res = await call(owner.cookies, `missing-${RUN}`);
      expect(res.status).toBe(404);
      expect((await err(res)).code).toBe("not-found");
    },
  );
});
