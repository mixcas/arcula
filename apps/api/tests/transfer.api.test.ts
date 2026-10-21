// Ownership transfer: the collection moves, the bytes do not.
//
//   POST /collections/{cid}/transfer   owner-only: transfer the collection
//
// The target must already be a collaborator. One transaction updates
// `collections.userId`, writes the collection's fixed media namespace back
// (a gap row's fallback is persisted here), mirrors the new owner onto every
// artwork and swaps the two membership rows: the recipient's goes, the
// previous owner's arrives. The media namespace is fixed, so every saved object
// keeps its key and every URL keeps working. The notice to the new owner is
// attempted after the commit; a provider failure answers `emailSent: false`
// and does not undo the transfer.
//
// The recipient's tier is never checked: receiving a collection may take an
// account over its cap, and creation stays blocked there afterwards.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  artworks as artworksTable,
  collectionCollaborators as collaboratorsTable,
  collections as collectionsTable,
} from "@arcula/db";
import type {
  ArtworkRead,
  Collection,
  CollectionAccess,
  CollectionTransferResponse,
} from "@arcula/shared";
import { closeDb, db } from "../src/db";
import { emailProvider } from "../src/email/provider";
import { finalPhotoPrefix, mediaUrl } from "../src/media/keys";
import { listObjects } from "../src/storage";
import { err, freshUser, json, req, uuid } from "./helpers/api";
import {
  makeCollection,
  makeJpeg,
  processEntry,
  stageDocument,
  stagePhoto,
} from "./helpers/fixtures";
import {
  linkIn,
  mailpitText,
  mailsFor,
  waitForNewMail,
} from "./helpers/mailpit";

const RUN = Math.random().toString(36).slice(2, 10);
const entry = (label: string): string => `${label}-${RUN}`;

type Account = { email: string; cookies: string; userId: string };

let owner: Account;
let mate: Account;
let stranger: Account;

const sourceJpeg = (async () => makeJpeg())();

const collectionPath = (cid: string) => `/api/v1/collections/${cid}`;
const listPath = (cid: string) => `${collectionPath(cid)}/artworks`;
const accessPath = (cid: string) => `${collectionPath(cid)}/access`;
const transferPath = (cid: string) => `${collectionPath(cid)}/transfer`;
const removePath = (cid: string, userId: string) =>
  `${collectionPath(cid)}/collaborators/${userId}`;
const leavePath = (cid: string) => `${collectionPath(cid)}/collaborators/me`;

/** A private collection shared with the accounts named. Its namespace is its
 *  owner's id — the shape 0004's backfill leaves on a pre-existing row. */
async function sharedCollection(
  members: Account[],
): Promise<{ cid: string; namespace: string }> {
  const cid = await makeCollection(owner.userId, {
    name: "Transfer Wall",
    isPublic: false,
    // The shape 0004's backfill leaves on a pre-existing row: its namespace
    // is its owner's id, and every key already built with it must keep
    // resolving after the owner moves.
    mediaNamespaceId: owner.userId,
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

/** A collection with the minted namespace `POST /collections` gives it — the
 *  production shape, rather than the migration gap's null column. */
async function mintedCollection(
  members: Account[],
): Promise<{ cid: string; namespace: string }> {
  const cid = uuid();
  const namespace = uuid();
  await db.insert(collectionsTable).values({
    id: cid,
    userId: owner.userId,
    mediaNamespaceId: namespace,
    name: "Minted Namespace Wall",
    isPublic: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  for (const account of members) {
    await db
      .insert(collaboratorsTable)
      .values({ collectionId: cid, userId: account.userId });
  }
  return { cid, namespace };
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

const transferAs = (cid: string, cookies: string, userId: string) =>
  req("POST", transferPath(cid), { cookies, body: { userId } });

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
          new File([new TextEncoder().encode("%PDF-1.4 %%EOF")], "cert.pdf", {
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

/** Save one published work with a photo and a document, recorded by `account`
 *  — the shape a collection carries when it is transferred. */
async function savedWork(
  account: Account,
  cid: string,
): Promise<{ aid: string; work: ArtworkRead }> {
  const aid = uuid();
  // Globally unique across calls: entry ids are primary keys, and this helper
  // runs once per collection.
  const photo = `${entry("transfer-photo")}-${uuid().slice(0, 8)}`;
  const doc = `${entry("transfer-doc")}-${uuid().slice(0, 8)}`;
  await stageAndProcess(account, cid, aid, "photos", photo);
  await stageAndProcess(account, cid, aid, "documents", doc);
  const saved = await req("POST", listPath(cid), {
    cookies: account.cookies,
    body: {
      artworkId: aid,
      title: "The Work Being Handed Over",
      artistName: "C. Cas",
      status: "published",
      photos: [{ entryId: photo, name: "scan.jpg" }],
      documents: [{ entryId: doc, name: "certificate.pdf" }],
    },
  });
  expect(saved.status).toBe(201);
  return { aid, work: await json<ArtworkRead>(saved) };
}

/** The object key a proxy URL names. */
function keyOf(url: string): string {
  const key = new URL(url, "http://localhost").searchParams.get("key");
  if (key === null) throw new Error(`The URL names no object key: ${url}`);
  return key;
}

beforeAll(async () => {
  owner = await freshUser("TransferOwner");
  mate = await freshUser("TransferMate");
  stranger = await freshUser("TransferOther");
});

afterAll(async () => {
  await closeDb();
});

describe("POST /collections/{cid}/transfer", () => {
  it("moves the owner, the artwork mirror and the memberships in one transaction, and leaves the namespace alone", async () => {
    const { cid, namespace } = await sharedCollection([mate]);
    const { aid, work } = await savedWork(mate, cid);

    // Before: the collection's owner wrote the mirror, and every saved object
    // lives under the namespace 0004's backfill gave the row (the owner's id).
    const [before] = await db
      .select()
      .from(collectionsTable)
      .where(eq(collectionsTable.id, cid));
    expect(before.userId).toBe(owner.userId);
    expect(before.mediaNamespaceId).toBe(namespace);
    expect(
      await listObjects(finalPhotoPrefix(namespace, cid, aid, entryOf(work))),
    ).toHaveLength(6);

    const res = await transferAs(cid, owner.cookies, mate.userId);
    expect(res.status).toBe(200);
    expect(await json<CollectionTransferResponse>(res)).toEqual({
      transferred: true,
      emailSent: true,
    });

    // The owner fact moved, and the namespace is the value every existing key
    // was built with — the transfer reads it and writes that same value back.
    const [row] = await db
      .select()
      .from(collectionsTable)
      .where(eq(collectionsTable.id, cid));
    expect(row.userId).toBe(mate.userId);
    expect(row.mediaNamespaceId).toBe(namespace);

    // The mirror moved, for every work in the collection.
    const works = await db
      .select()
      .from(artworksTable)
      .where(eq(artworksTable.collectionId, cid));
    expect(works.map((w) => w.userId)).toEqual([mate.userId]);

    // The two membership rows swapped: the recipient is the owner fact now,
    // and the previous owner is a collaborator.
    expect(await membership(cid, mate.userId)).toBeUndefined();
    expect(await membership(cid, owner.userId)).toBeDefined();

    // Both accounts' access reads agree about the new roles.
    const mateAccess = await json<CollectionAccess>(
      await req("GET", accessPath(cid), { cookies: mate.cookies }),
    );
    expect(mateAccess.role).toBe("owner");
    expect(mateAccess.owner.userId).toBe(mate.userId);
    const ownerAccess = await json<CollectionAccess>(
      await req("GET", accessPath(cid), { cookies: owner.cookies }),
    );
    expect(ownerAccess.role).toBe("collaborator");

    // The bytes never moved: the same key, the same object, under the new
    // owner and for the previous one as a collaborator.
    for (const url of [
      work.photos[0].original.url,
      work.documents[0].original.url,
    ]) {
      for (const cookies of [mate.cookies, owner.cookies]) {
        const served = await req("GET", mediaUrl(keyOf(url)), { cookies });
        expect(served.status, `${cookies} ${url}`).toBe(200);
      }
    }
    expect(
      await listObjects(finalPhotoPrefix(namespace, cid, aid, entryOf(work))),
    ).toHaveLength(6);
    // Nothing was copied into a namespace named by the new owner: a transfer
    // that moved the namespace would leave these here.
    expect(
      await listObjects(finalPhotoPrefix(mate.userId, cid, aid, entryOf(work))),
    ).toEqual([]);
  });

  it("keeps a minted namespace, so the transferred work keeps the same URL", async () => {
    // The production shape: `mediaNamespaceId` was minted at creation and is
    // not the owner's id, so an unconditional rewrite here would strand every
    // saved object behind a URL that no longer resolves.
    const { cid, namespace } = await mintedCollection([mate]);
    const { aid, work } = await savedWork(mate, cid);
    const original = keyOf(work.photos[0].original.url);
    expect(original).toContain(`/${namespace}/`);

    expect((await transferAs(cid, owner.cookies, mate.userId)).status).toBe(
      200,
    );

    // The row the serializer reads still names the minted namespace…
    const [row] = await db
      .select()
      .from(collectionsTable)
      .where(eq(collectionsTable.id, cid));
    expect(row.mediaNamespaceId).toBe(namespace);

    // …so the work's URL is byte-for-byte the key it was saved under, and it
    // still serves.
    const after = await json<ArtworkRead>(
      await req("GET", `${listPath(cid)}/${aid}`, { cookies: mate.cookies }),
    );
    expect(keyOf(after.photos[0].original.url)).toBe(original);
    expect(
      (await req("GET", mediaUrl(original), { cookies: mate.cookies })).status,
    ).toBe(200);
    expect(
      await listObjects(finalPhotoPrefix(namespace, cid, aid, entryOf(work))),
    ).toHaveLength(6);
    expect(
      await listObjects(
        finalPhotoPrefix(owner.userId, cid, aid, entryOf(work)),
      ),
    ).toEqual([]);
  });

  it("notices the new owner and links to the collection's manage page", async () => {
    const { cid } = await sharedCollection([mate]);
    const seenIds = (await mailsFor(mate.email)).map((mail) => mail.ID);

    expect((await transferAs(cid, owner.cookies, mate.userId)).status).toBe(
      200,
    );

    const mail = await waitForNewMail(mate.email, seenIds);
    expect(mail.Subject).toContain("Transfer Wall");
    const url = linkIn(await mailpitText(mail.ID));
    expect(url.origin).toBe("http://localhost:3000");
    expect(url.pathname).toBe(`/manage/collection/transfer-wall-${cid}`);
  });

  it("never checks the recipient's tier, and creation stays blocked over the cap", async () => {
    // A dedicated recipient: it already owns the free tier's one collection,
    // so the transfer is what takes it over the cap.
    const capped = await freshUser("TransferCapped");
    await makeCollection(capped.userId, { name: "Capped's Own" });

    const { cid } = await sharedCollection([capped]);
    const res = await transferAs(cid, owner.cookies, capped.userId);
    expect(res.status).toBe(200);
    expect(await json<CollectionTransferResponse>(res)).toMatchObject({
      transferred: true,
    });

    // Two owned collections now, and the cap still gates creation.
    const dashboard = await json<Collection[]>(
      await req("GET", "/api/v1/collections", { cookies: capped.cookies }),
    );
    expect(
      dashboard.filter((row) => row.role === "owner").map((row) => row.id),
    ).toEqual(expect.arrayContaining([cid]));
    const over = await req("POST", "/api/v1/collections", {
      cookies: capped.cookies,
      body: { name: "Still Blocked", isPublic: false },
    });
    expect(over.status).toBe(409);
    expect((await err(over)).code).toBe("limit-reached");
  });

  it("is owner-only, and conflicts on the owner or a target who is not a collaborator", async () => {
    const { cid } = await sharedCollection([mate, stranger]);

    // A collaborator is a member but never an access administrator.
    for (const cookies of [mate.cookies, stranger.cookies]) {
      const refused = await transferAs(cid, cookies, stranger.userId);
      expect(refused.status).toBe(403);
      expect((await err(refused)).code).toBe("forbidden");
    }

    // Namely the owner: a transfer to themselves is a state conflict.
    const self = await transferAs(cid, owner.cookies, owner.userId);
    expect(self.status).toBe(409);
    expect((await err(self)).code).toBe("conflict");

    // Somebody with no membership row here is the same conflict. (Stranger is
    // a collaborator in this fixture, so a fourth account stands in.)
    const outsider = await freshUser("TransferOutsider");
    const notAMember = await transferAs(cid, owner.cookies, outsider.userId);
    expect(notAMember.status).toBe(409);
    expect((await err(notAMember)).code).toBe("conflict");

    // Every refusal left the collection exactly as it was.
    const [row] = await db
      .select()
      .from(collectionsTable)
      .where(eq(collectionsTable.id, cid));
    expect(row.userId).toBe(owner.userId);
    expect(await membership(cid, mate.userId)).toBeDefined();
    expect(await membership(cid, stranger.userId)).toBeDefined();

    const missing = await transferAs(
      `missing-${RUN}`,
      owner.cookies,
      mate.userId,
    );
    expect(missing.status).toBe(404);
    const anonymous = await req("POST", transferPath(cid), {
      body: { userId: mate.userId },
    });
    expect(anonymous.status).toBe(401);
    const noTarget = await req("POST", transferPath(cid), {
      cookies: owner.cookies,
      body: {},
    });
    expect(noTarget.status).toBe(400);
    expect((await err(noTarget)).fields).toHaveProperty("userId");
  });

  it("commits the transfer even when the notice cannot be sent", async () => {
    const { cid } = await sharedCollection([mate]);
    const send = vi
      .spyOn(emailProvider, "send")
      .mockRejectedValueOnce(new Error("the mail provider is down"));
    try {
      const res = await transferAs(cid, owner.cookies, mate.userId);
      expect(res.status).toBe(200);
      expect(await json<CollectionTransferResponse>(res)).toEqual({
        transferred: true,
        emailSent: false,
      });
    } finally {
      send.mockRestore();
    }

    // The row is the durable fact: the failure was reported, not fatal.
    const [row] = await db
      .select()
      .from(collectionsTable)
      .where(eq(collectionsTable.id, cid));
    expect(row.userId).toBe(mate.userId);
    expect(await membership(cid, owner.userId)).toBeDefined();
  });

  it("leaves the previous owner a collaborator who may leave, and whom the new owner may remove", async () => {
    // First collection: the previous owner leaves deliberately.
    const first = await sharedCollection([mate]);
    expect(
      (await transferAs(first.cid, owner.cookies, mate.userId)).status,
    ).toBe(200);
    const left = await req("DELETE", leavePath(first.cid), {
      cookies: owner.cookies,
    });
    expect(left.status).toBe(200);
    expect(
      (await req("GET", accessPath(first.cid), { cookies: owner.cookies }))
        .status,
    ).toBe(403);

    // Second collection: the new owner removes them instead.
    const second = await sharedCollection([mate]);
    expect(
      (await transferAs(second.cid, owner.cookies, mate.userId)).status,
    ).toBe(200);
    const removed = await req("DELETE", removePath(second.cid, owner.userId), {
      cookies: mate.cookies,
    });
    expect(removed.status).toBe(200);
    expect(
      (await req("GET", accessPath(second.cid), { cookies: owner.cookies }))
        .status,
    ).toBe(403);
  });
});

/** The photo entry id is the work document's first photo id. */
function entryOf(work: ArtworkRead): string {
  return work.photos[0].id;
}
