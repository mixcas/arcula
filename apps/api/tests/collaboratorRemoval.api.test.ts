// Access can end, and it ends on the next request.
//
//   DELETE /collections/{cid}/collaborators/{userId}   owner: remove somebody
//   DELETE /collections/{cid}/collaborators/me         collaborator: leave
//
// Both delete the membership row and nothing else that is saved: the works the
// departing account recorded stay in the collection, with their final objects,
// and the account is a visitor from its next request on — the collection, its
// works, its documents and its bytes included.
//
// The one thing that is discarded is that account's unsaved uploads for that
// one collection: its staging prefix, best effort. A storage failure does not
// fail the action — the seven-day staging lifecycle is the backstop — and
// another member's prefix, or the departing account's staging in another
// collection, is never touched.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  collectionCollaborators as collaboratorsTable,
  collections as collectionsTable,
} from "@arcula/db";
import type { ArtworkRead, Collection, CollectionAccess } from "@arcula/shared";
import { closeDb, db } from "../src/db";
import {
  finalPhotoPrefix,
  mediaUrl,
  stagedArtworkPrefix,
} from "../src/media/keys";
import { listObjects, s3 } from "../src/storage";
import { err, freshUser, json, req, uuid } from "./helpers/api";
import {
  makeCollection,
  makeJpeg,
  processEntry,
  stageDocument,
  stagePhoto,
} from "./helpers/fixtures";

const RUN = Math.random().toString(36).slice(2, 10);
const entry = (label: string): string => `${label}-${RUN}`;

type Account = { email: string; cookies: string; userId: string };

let owner: Account;
let mate: Account;
let stranger: Account;

const sourceJpeg = (async () => makeJpeg())();
const makePdf = (): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(new TextEncoder().encode("%PDF-1.4 (test) %%EOF"));

const collectionPath = (cid: string) => `/api/v1/collections/${cid}`;
const listPath = (cid: string) => `${collectionPath(cid)}/artworks`;
const accessPath = (cid: string) => `${collectionPath(cid)}/access`;
const removePath = (cid: string, userId: string) =>
  `${collectionPath(cid)}/collaborators/${userId}`;
const leavePath = (cid: string) => `${collectionPath(cid)}/collaborators/me`;

/** A collection (private by default — the strongest read refusal: `403` for a
 *  non-member) shared with the accounts named. */
async function sharedCollection(
  members: Account[],
  { isPublic = false }: { isPublic?: boolean } = {},
): Promise<{ cid: string; namespace: string }> {
  const cid = await makeCollection(owner.userId, {
    name: "Shared Removal Wall",
    isPublic,
  });
  for (const account of members) {
    await db
      .insert(collaboratorsTable)
      .values({ collectionId: cid, userId: account.userId });
  }
  const [row] = await db
    .select()
    .from(collectionsTable)
    .where(eq(collectionsTable.id, cid));
  return { cid, namespace: row.mediaNamespaceId };
}

const membership = async (cid: string, userId: string) =>
  (
    await db
      .select()
      .from(collaboratorsTable)
      .where(
        and(
          eq(collaboratorsTable.collectionId, cid),
          eq(collaboratorsTable.userId, userId),
        ),
      )
  )[0];

async function stageAndProcess(
  account: Account,
  cid: string,
  aid: string,
  population: "photos" | "documents",
  entryId: string,
): Promise<void> {
  const staged =
    population === "photos"
      ? await stagePhoto(
          account.cookies,
          cid,
          aid,
          entryId,
          new File([await sourceJpeg], "scan.jpg", { type: "image/jpeg" }),
        )
      : await stageDocument(
          account.cookies,
          cid,
          aid,
          entryId,
          new File([makePdf()], "certificate.pdf", {
            type: "application/pdf",
          }),
        );
  expect(staged.status).toBe(200);
  const processed = await processEntry(
    account.cookies,
    cid,
    aid,
    population,
    JSON.stringify({ entryId }),
  );
  expect(processed.status).toBe(200);
}

/** The object key a proxy URL names. */
function keyOf(url: string): string {
  const key = new URL(url, "http://localhost").searchParams.get("key");
  if (key === null) throw new Error(`The URL names no object key: ${url}`);
  return key;
}

beforeAll(async () => {
  owner = await freshUser("RemovalOwner");
  mate = await freshUser("RemovalMate");
  stranger = await freshUser("RemovalOther");
});

afterAll(async () => {
  await closeDb();
});

describe("DELETE /collections/{cid}/collaborators/{userId}", () => {
  it("removes the collaborator, who is a visitor from its next request", async () => {
    const { cid, namespace } = await sharedCollection([mate]);

    // The work a collaborator records, with a photo and a document that belong
    // to the collection once saved.
    const aid = uuid();
    const photo = entry("rm-photo");
    const doc = entry("rm-doc");
    await stageAndProcess(mate, cid, aid, "photos", photo);
    await stageAndProcess(mate, cid, aid, "documents", doc);
    const saved = await req("POST", listPath(cid), {
      cookies: mate.cookies,
      body: {
        artworkId: aid,
        title: "Saved By A Collaborator",
        artistName: "C. Cas",
        status: "published",
        photos: [{ entryId: photo, name: "scan.jpg" }],
        documents: [{ entryId: doc, name: "certificate.pdf" }],
      },
    });
    expect(saved.status).toBe(201);
    const work = await json<ArtworkRead>(saved);

    // An unsaved upload the removal must discard: it is still staged when the
    // membership ends.
    const leftover = entry("rm-leftover");
    await stageAndProcess(mate, cid, aid, "photos", leftover);

    // While a collaborator: the collection, the work, its photo and its
    // document all answer.
    expect(
      (await req("GET", collectionPath(cid), { cookies: mate.cookies })).status,
    ).toBe(200);
    for (const url of [
      work.photos[0].original.url,
      work.documents[0].original.url,
    ]) {
      expect(
        (await req("GET", mediaUrl(keyOf(url)), { cookies: mate.cookies }))
          .status,
      ).toBe(200);
    }

    const res = await req("DELETE", removePath(cid, mate.userId), {
      cookies: owner.cookies,
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ removed: true });

    // The membership row is the access fact, and it is gone.
    expect(await membership(cid, mate.userId)).toBeUndefined();
    const access = await json<CollectionAccess>(
      await req("GET", accessPath(cid), { cookies: owner.cookies }),
    );
    expect(access.collaborators.map((c) => c.userId)).not.toContain(
      mate.userId,
    );
    // …and the dashboard no longer lists it for them.
    const dashboard = await json<Collection[]>(
      await req("GET", "/api/v1/collections", { cookies: mate.cookies }),
    );
    expect(dashboard.map((c) => c.id)).not.toContain(cid);

    // Their next requests: a private collection refuses the way it refuses a
    // stranger — the collection and its list `403`, the work and its photo
    // `404` (the uniform visitor refusal), the document `403`, the access read
    // `403`.
    for (const [path, status] of [
      [collectionPath(cid), 403],
      [listPath(cid), 403],
      [accessPath(cid), 403],
      [`${listPath(cid)}/${aid}`, 404],
      [mediaUrl(keyOf(work.documents[0].original.url)), 403],
    ] as const) {
      const refused = await req("GET", path, { cookies: mate.cookies });
      expect(refused.status, path).toBe(status);
    }
    expect(
      (
        await req("GET", mediaUrl(keyOf(work.photos[0].original.url)), {
          cookies: mate.cookies,
        })
      ).status,
    ).toBe(404);

    // Writes answer the membership refusal too: the settings, a new work and
    // a staged upload are not a visitor's to make.
    expect(
      (
        await req("PATCH", collectionPath(cid), {
          cookies: mate.cookies,
          body: { name: "Hijacked" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req("POST", listPath(cid), {
          cookies: mate.cookies,
          body: { artworkId: uuid(), title: "T", artistName: "C. Cas" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await stagePhoto(
          mate.cookies,
          cid,
          aid,
          entry("rm-after"),
          new File([await sourceJpeg], "scan.jpg", { type: "image/jpeg" }),
        )
      ).status,
    ).toBe(403);

    // The staged leftover is gone, and the key would be refused even if it
    // were not: the uploader's prefix alone is not access.
    expect(
      await listObjects(stagedArtworkPrefix(mate.userId, cid, aid)),
    ).toEqual([]);
    const stagedKey = `staging/${mate.userId}/${cid}/${aid}/${leftover}.jpg`;
    expect(
      (await req("GET", mediaUrl(stagedKey), { cookies: mate.cookies })).status,
    ).toBe(403);

    // What stays: the saved work, its document, and every final object.
    const ownerList = await json<ArtworkRead[]>(
      await req("GET", listPath(cid), { cookies: owner.cookies }),
    );
    expect(ownerList.map((w) => w.id)).toContain(aid);
    const ownerRead = await req("GET", `${listPath(cid)}/${aid}`, {
      cookies: owner.cookies,
    });
    expect(ownerRead.status).toBe(200);
    expect(await json<ArtworkRead>(ownerRead)).toEqual(work);
    for (const url of [
      work.photos[0].original.url,
      work.documents[0].original.url,
    ]) {
      expect(
        (await req("GET", mediaUrl(keyOf(url)), { cookies: owner.cookies }))
          .status,
      ).toBe(200);
    }
    expect(
      await listObjects(finalPhotoPrefix(namespace, cid, aid, photo)),
    ).toHaveLength(7);
  });

  it("changes only the membership: a public collection's works stay public, its documents do not", async () => {
    const { cid } = await sharedCollection([mate], { isPublic: true });
    const aid = uuid();
    const photo = entry("rm-public-photo");
    const doc = entry("rm-public-doc");
    await stageAndProcess(mate, cid, aid, "photos", photo);
    await stageAndProcess(mate, cid, aid, "documents", doc);
    const saved = await req("POST", listPath(cid), {
      cookies: mate.cookies,
      body: {
        artworkId: aid,
        title: "Published Before Removal",
        artistName: "C. Cas",
        status: "published",
        photos: [{ entryId: photo, name: "scan.jpg" }],
        documents: [{ entryId: doc, name: "certificate.pdf" }],
      },
    });
    expect(saved.status).toBe(201);
    const work = await json<ArtworkRead>(saved);

    const res = await req("DELETE", removePath(cid, mate.userId), {
      cookies: owner.cookies,
    });
    expect(res.status).toBe(200);

    // The visitor rule is untouched by the removal: the public collection,
    // the published work and its photo read for the departed account, exactly
    // as they read for any visitor.
    for (const path of [
      collectionPath(cid),
      `${listPath(cid)}/${aid}`,
      mediaUrl(keyOf(work.photos[0].original.url)),
    ]) {
      expect(
        (await req("GET", path, { cookies: mate.cookies })).status,
        path,
      ).toBe(200);
    }

    // A document never reads for a visitor, and the departed account is one.
    const document = await req(
      "GET",
      mediaUrl(keyOf(work.documents[0].original.url)),
      { cookies: mate.cookies },
    );
    expect(document.status).toBe(403);
    expect((await err(document)).code).toBe("forbidden");

    // Nor does the access read: who else has access is a member's view.
    expect(
      (await req("GET", accessPath(cid), { cookies: mate.cookies })).status,
    ).toBe(403);
  });

  it("is owner-only, and conflicts on the owner and on a non-collaborator", async () => {
    const { cid } = await sharedCollection([mate]);

    // A collaborator is a member but never an access administrator — not even
    // of themselves.
    for (const target of [mate.userId, stranger.userId]) {
      const byMate = await req("DELETE", removePath(cid, target), {
        cookies: mate.cookies,
      });
      expect(byMate.status).toBe(403);
      expect((await err(byMate)).code).toBe("forbidden");
    }
    expect(await membership(cid, mate.userId)).toBeDefined();

    // The owner is the owner fact, never a collaborator row. Even a stray row
    // naming them — a hand-written seed, a former transfer's leftover — is not
    // a membership to remove: it is a state conflict, and the row stays.
    await db
      .insert(collaboratorsTable)
      .values({ collectionId: cid, userId: owner.userId });
    const theOwner = await req("DELETE", removePath(cid, owner.userId), {
      cookies: owner.cookies,
    });
    expect(theOwner.status).toBe(409);
    expect((await err(theOwner)).code).toBe("conflict");
    expect(await membership(cid, owner.userId)).toBeDefined();

    // Somebody with no row here is the same conflict.
    const notAMember = await req("DELETE", removePath(cid, stranger.userId), {
      cookies: owner.cookies,
    });
    expect(notAMember.status).toBe(409);
    expect((await err(notAMember)).code).toBe("conflict");

    // A second removal cannot find the row the first one took.
    const first = await req("DELETE", removePath(cid, mate.userId), {
      cookies: owner.cookies,
    });
    expect(first.status).toBe(200);
    const again = await req("DELETE", removePath(cid, mate.userId), {
      cookies: owner.cookies,
    });
    expect(again.status).toBe(409);

    // A missing collection is `404` for the owner too.
    const missing = await req(
      "DELETE",
      removePath(`missing-${RUN}`, mate.userId),
      { cookies: owner.cookies },
    );
    expect(missing.status).toBe(404);
    expect((await err(missing)).code).toBe("not-found");
  });

  it("discards the target's unsaved uploads for that collection only", async () => {
    // Two shared collections: removal from one must not reach the other.
    const first = await sharedCollection([mate]);
    const second = await sharedCollection([mate]);
    const aid = uuid();

    const theirFirst = entry("rm-scope-a");
    const theirSecond = entry("rm-scope-b");
    const ownersOwn = entry("rm-scope-owner");
    await stageAndProcess(mate, first.cid, aid, "photos", theirFirst);
    await stageAndProcess(mate, second.cid, aid, "photos", theirSecond);
    await stageAndProcess(owner, first.cid, aid, "photos", ownersOwn);

    const res = await req("DELETE", removePath(first.cid, mate.userId), {
      cookies: owner.cookies,
    });
    expect(res.status).toBe(200);

    // The target's prefix in THIS collection is empty…
    expect(
      await listObjects(stagedArtworkPrefix(mate.userId, first.cid, aid)),
    ).toEqual([]);
    // …their prefix in the other collection survives…
    expect(
      await listObjects(stagedArtworkPrefix(mate.userId, second.cid, aid)),
    ).toHaveLength(7);
    // …and so does the owner's in the same collection.
    expect(
      await listObjects(stagedArtworkPrefix(owner.userId, first.cid, aid)),
    ).toHaveLength(7);
  });

  it("still succeeds when the storage cleanup fails", async () => {
    const { cid } = await sharedCollection([mate]);
    const aid = uuid();
    const unsaved = entry("rm-storage");
    await stageAndProcess(mate, cid, aid, "photos", unsaved);

    // The first object operation the removal makes is the listing.
    const send = vi
      .spyOn(s3, "send")
      .mockRejectedValueOnce(new Error("S3 is down"));
    try {
      const res = await req("DELETE", removePath(cid, mate.userId), {
        cookies: owner.cookies,
      });
      expect(res.status).toBe(200);
      // The access fact is the row, and it landed: the lifecycle is the
      // backstop for the objects the cleanup could not reach.
      expect(await membership(cid, mate.userId)).toBeUndefined();
      expect(
        (await req("GET", collectionPath(cid), { cookies: mate.cookies }))
          .status,
      ).toBe(403);
    } finally {
      send.mockRestore();
    }
  });
});

describe("DELETE /collections/{cid}/collaborators/me", () => {
  it("lets a collaborator leave, keeping the work they saved", async () => {
    const { cid } = await sharedCollection([mate]);

    const aid = uuid();
    const photo = entry("leave-photo");
    await stageAndProcess(mate, cid, aid, "photos", photo);
    const saved = await req("POST", listPath(cid), {
      cookies: mate.cookies,
      body: {
        artworkId: aid,
        title: "Saved Before Leaving",
        artistName: "C. Cas",
        status: "draft",
        photos: [{ entryId: photo, name: "scan.jpg" }],
      },
    });
    expect(saved.status).toBe(201);
    const work = await json<ArtworkRead>(saved);

    const leftover = entry("leave-leftover");
    await stageAndProcess(mate, cid, aid, "photos", leftover);

    const res = await req("DELETE", leavePath(cid), {
      cookies: mate.cookies,
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ left: true });

    // The membership row is the access fact, and it is gone.
    expect(await membership(cid, mate.userId)).toBeUndefined();
    const dashboard = await json<Collection[]>(
      await req("GET", "/api/v1/collections", { cookies: mate.cookies }),
    );
    expect(dashboard.map((c) => c.id)).not.toContain(cid);
    expect(
      (await req("GET", listPath(cid), { cookies: mate.cookies })).status,
    ).toBe(403);

    // Their own unsaved upload is discarded…
    expect(
      await listObjects(stagedArtworkPrefix(mate.userId, cid, aid)),
    ).toEqual([]);
    // …and the works stay for the owner, with their bytes.
    const ownerList = await json<ArtworkRead[]>(
      await req("GET", listPath(cid), { cookies: owner.cookies }),
    );
    expect(ownerList.map((w) => w.id)).toContain(aid);
    const ownerRead = await req("GET", `${listPath(cid)}/${aid}`, {
      cookies: owner.cookies,
    });
    expect(ownerRead.status).toBe(200);
    expect(await json<ArtworkRead>(ownerRead)).toEqual(work);
    expect(
      (
        await req("GET", mediaUrl(keyOf(work.photos[0].original.url)), {
          cookies: owner.cookies,
        })
      ).status,
    ).toBe(200);

    // Leaving again finds no membership: the caller is a stranger now.
    const again = await req("DELETE", leavePath(cid), {
      cookies: mate.cookies,
    });
    expect(again.status).toBe(403);
  });

  it("conflicts for the owner, who must transfer first, and 403s a non-member", async () => {
    const { cid } = await sharedCollection([mate]);

    const byOwner = await req("DELETE", leavePath(cid), {
      cookies: owner.cookies,
    });
    expect(byOwner.status).toBe(409);
    expect((await err(byOwner)).code).toBe("conflict");
    // The owner still owns it.
    expect(
      (await req("GET", collectionPath(cid), { cookies: owner.cookies }))
        .status,
    ).toBe(200);

    const byStranger = await req("DELETE", leavePath(cid), {
      cookies: stranger.cookies,
    });
    expect(byStranger.status).toBe(403);
    expect((await err(byStranger)).code).toBe("forbidden");

    const anonymous = await req("DELETE", leavePath(cid));
    expect(anonymous.status).toBe(401);

    const missing = await req("DELETE", leavePath(`missing-${RUN}`), {
      cookies: mate.cookies,
    });
    expect(missing.status).toBe(404);
  });
});
