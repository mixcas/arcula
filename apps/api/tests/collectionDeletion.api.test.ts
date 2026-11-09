// Deleting a collection: owner-only, and gone everywhere afterwards.
//
//   DELETE /collections/{cid}   owner-only: stamp deletedAt, withdraw the
//                               pending invitations, close the Access grants
//
// One transaction does the three writes, so no request can see a deleted
// collection that still holds live offers or valid grants. Nothing cascades:
// the works, their media and the collaborator rows stay, which is what makes
// the operator's restore a one-column update (spec #212).
//
// The not-found posture is one chokepoint, not a per-route change: the shared
// loader `authorize.ts` refuses a stamped row, so every address that names the
// collection answers 404 and the four raw queries that bypass it filter their
// own rows. The PDF export is client-side and reads through the collection
// and artwork endpoints, so it is covered by those reads; the API's only PDF
// route is the public font subset, which names no collection.
//
// This is the real-stack seam: the wire answer, the rows that moved and the
// bytes that did not. The settings-page component suite owns the card.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  artworkDocuments as artworkDocumentsTable,
  artworkPhotos as artworkPhotosTable,
  artworks as artworksTable,
  collectionAccessGrants as grantsTable,
  collectionCollaborators as collaboratorsTable,
  collectionInvitations as invitationsTable,
  collections as collectionsTable,
} from "@arcula/db";
import type {
  InvitationCreateResponse,
  InvitationInboxEntry,
} from "@arcula/shared";
import { closeDb, db } from "../src/db";
import {
  finalDocumentPrefix,
  finalPhotoPrefix,
  mediaUrl,
} from "../src/media/keys";
import { listObjects } from "../src/storage";
import { err, freshUser, json, req, uuid } from "./helpers/api";
import {
  makeArtwork,
  makeCollection,
  makeInvitation,
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

type Account = { email: string; cookies: string; userId: string };

const RUN = Math.random().toString(36).slice(2, 10);

let owner: Account;
let mate: Account;
let stranger: Account;
let invitee: Account;

const collectionPath = (cid: string) => `/api/v1/collections/${cid}`;

/** The object key a proxy URL names. */
function keyOf(url: string): string {
  const key = new URL(url, "http://localhost").searchParams.get("key");
  if (key === null) throw new Error(`The URL names no object key: ${url}`);
  return key;
}

interface MediaFixture {
  cid: string;
  namespace: string;
  aid: string;
  deletedAid: string;
  photoId: string;
  documentId: string;
  photoKey: string;
  documentKey: string;
}

/** A public collection with a published work (one photo, one document) and a
 *  work already carrying its own deletion stamp. Created through the routes,
 *  apart from the collection row itself (the cap is not this file's subject). */
async function collectionWithMedia(name: string): Promise<MediaFixture> {
  const cid = await makeCollection(owner.userId, { isPublic: true, name });
  await db
    .insert(collaboratorsTable)
    .values({ collectionId: cid, userId: mate.userId });

  const aid = uuid();
  const photoEntry = `photo${uuid()}`;
  const documentEntry = `document${uuid()}`;
  const photo = new File([await makeJpeg()], "scan.jpg", {
    type: "image/jpeg",
  });
  const document = new File(
    [new TextEncoder().encode("%PDF-1.4 (test)")],
    "certificate.pdf",
    { type: "application/pdf" },
  );
  expect(
    (await stagePhoto(owner.cookies, cid, aid, photoEntry, photo)).status,
  ).toBe(200);
  expect(
    (
      await processEntry(
        owner.cookies,
        cid,
        aid,
        "photos",
        JSON.stringify({ entryId: photoEntry }),
      )
    ).status,
  ).toBe(200);
  expect(
    (await stageDocument(owner.cookies, cid, aid, documentEntry, document))
      .status,
  ).toBe(200);
  expect(
    (
      await processEntry(
        owner.cookies,
        cid,
        aid,
        "documents",
        JSON.stringify({ entryId: documentEntry }),
      )
    ).status,
  ).toBe(200);
  const saved = await req("POST", `${collectionPath(cid)}/artworks`, {
    cookies: owner.cookies,
    body: {
      artworkId: aid,
      title: "The Work That Stays",
      artistName: "C. Cas",
      status: "published",
      photos: [{ entryId: photoEntry, name: "scan.jpg" }],
      documents: [{ entryId: documentEntry, name: "certificate.pdf" }],
    },
  });
  expect(saved.status).toBe(201);

  // A work whose own deletion stamp must survive the collection's.
  const deletedAid = await makeArtwork(owner.userId, cid);
  expect(
    (
      await req("POST", `${collectionPath(cid)}/artworks/bulk-delete`, {
        cookies: owner.cookies,
        body: { artworkIds: [deletedAid] },
      })
    ).status,
  ).toBe(200);

  const read = await json<{
    photos: { id: string; original: { url: string } }[];
    documents: { id: string; original: { url: string } }[];
  }>(
    await req("GET", `${collectionPath(cid)}/artworks/${aid}`, {
      cookies: owner.cookies,
    }),
  );
  return {
    cid,
    // `makeCollection`'s default namespace: the owner's id, the shape
    // 0004's backfill leaves on a pre-existing row.
    namespace: owner.userId,
    aid,
    deletedAid,
    photoId: read.photos[0].id,
    documentId: read.documents[0].id,
    photoKey: keyOf(read.photos[0].original.url),
    documentKey: keyOf(read.documents[0].original.url),
  };
}

/** A public collection shared with `mate`. Written straight through drizzle:
 *  the tier cap gives each account one created collection, and the cap is
 *  the subject of its own case, not of every fixture. */
async function sharedCollection(name: string): Promise<string> {
  const cid = await makeCollection(owner.userId, { isPublic: true, name });
  await db
    .insert(collaboratorsTable)
    .values({ collectionId: cid, userId: mate.userId });
  return cid;
}

beforeAll(async () => {
  owner = await freshUser("DeleteOwner");
  mate = await freshUser("DeleteMate");
  stranger = await freshUser("DeleteOther");
  invitee = await freshUser("DeleteInvitee");
});

afterAll(async () => {
  await closeDb();
});

describe("DELETE /collections/{cid}", () => {
  it("answers 204 to the owner, 403 to a collaborator, 401 with no session, and 404 to a second delete", async () => {
    const cid = await sharedCollection("Delete Me");

    // A collaborator is a member but never the owner.
    const refused = await req("DELETE", collectionPath(cid), {
      cookies: mate.cookies,
    });
    expect(refused.status).toBe(403);
    expect((await err(refused)).code).toBe("forbidden");
    // The refusal moved nothing.
    const [before] = await db
      .select()
      .from(collectionsTable)
      .where(eq(collectionsTable.id, cid));
    expect(before.deletedAt).toBeNull();

    const anonymous = await req("DELETE", collectionPath(cid));
    expect(anonymous.status).toBe(401);
    expect((await err(anonymous)).code).toBe("unauthorized");

    const deleted = await req("DELETE", collectionPath(cid), {
      cookies: owner.cookies,
    });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    const [stamped] = await db
      .select()
      .from(collectionsTable)
      .where(eq(collectionsTable.id, cid));
    expect(stamped.deletedAt).toBeInstanceOf(Date);

    // A second delete is not an error the user can act on: absent and
    // already deleted are the same answer.
    const again = await req("DELETE", collectionPath(cid), {
      cookies: owner.cookies,
    });
    expect(again.status).toBe(404);
    expect((await err(again)).code).toBe("not-found");

    const missing = await req("DELETE", `/api/v1/collections/missing-${RUN}`, {
      cookies: owner.cookies,
    });
    expect(missing.status).toBe(404);
  });

  it("leaves the anonymous list and both dashboards", async () => {
    const cid = await sharedCollection("Listed Wall");
    type ListRow = { id: string; role?: string };
    const list = async (cookies?: string): Promise<ListRow[]> =>
      await json<ListRow[]>(
        await req("GET", "/api/v1/collections", { cookies }),
      );

    // Present before, under each caller's own role.
    expect((await list()).some((row) => row.id === cid)).toBe(true);
    expect(
      (await list(owner.cookies)).find((row) => row.id === cid)?.role,
    ).toBe("owner");
    expect((await list(mate.cookies)).find((row) => row.id === cid)?.role).toBe(
      "collaborator",
    );

    expect(
      (await req("DELETE", collectionPath(cid), { cookies: owner.cookies }))
        .status,
    ).toBe(204);

    // Absent from the anonymous public list, the owner's dashboard and the
    // collaborator's — the same row, three queries.
    expect((await list()).some((row) => row.id === cid)).toBe(false);
    expect((await list(owner.cookies)).some((row) => row.id === cid)).toBe(
      false,
    );
    expect((await list(mate.cookies)).some((row) => row.id === cid)).toBe(
      false,
    );
  });

  it("withdraws the pending invitation, kills the mailed link, and leaves resolved history alone", async () => {
    const cid = await sharedCollection("Invitation Wall");
    const seen = (await mailsFor(invitee.email)).map((mail) => mail.ID);

    // A resolved row is history: the delete's withdrawal must not touch it.
    const declined = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: `declined-${RUN}@example.test`,
      status: "declined",
    });
    const [historyBefore] = await db
      .select()
      .from(invitationsTable)
      .where(eq(invitationsTable.id, declined.id));

    const invited = await req("POST", `${collectionPath(cid)}/invitations`, {
      cookies: owner.cookies,
      body: { email: invitee.email },
    });
    expect(invited.status).toBe(201);
    const created = await json<InvitationCreateResponse>(invited);

    // The link as delivered, not as the fixture might have minted it.
    const mail = await waitForNewMail(invitee.email, seen);
    const token = linkIn(await mailpitText(mail.ID)).pathname.slice(
      "/invite/".length,
    );

    // Before the delete the offer is live and in the invitee's inbox.
    const inbox = async () =>
      await json<InvitationInboxEntry[]>(
        await req("GET", "/api/v1/me/invitations", {
          cookies: invitee.cookies,
        }),
      );
    expect(
      (await inbox()).some((row) => row.id === created.invitation.id),
    ).toBe(true);
    expect((await req("GET", `/api/v1/invitations/${token}`)).status).toBe(200);

    expect(
      (await req("DELETE", collectionPath(cid), { cookies: owner.cookies }))
        .status,
    ).toBe(204);

    const [revoked] = await db
      .select()
      .from(invitationsTable)
      .where(eq(invitationsTable.id, created.invitation.id));
    expect(revoked.status).toBe("revoked");
    expect(revoked.resolvedAt).toBeInstanceOf(Date);
    const [history] = await db
      .select()
      .from(invitationsTable)
      .where(eq(invitationsTable.id, declined.id));
    expect(history.status).toBe("declined");
    expect(history.resolvedAt?.toISOString()).toBe(
      historyBefore.resolvedAt?.toISOString(),
    );
    expect(history.tokenHash).toBe(historyBefore.tokenHash);

    // The mailed link is gone for everyone who could hold it open: no
    // preview and no acceptance, whichever account asks.
    const accounts: [string, Account][] = [
      ["owner", owner],
      ["collaborator", mate],
      ["visitor", stranger],
      ["invitee", invitee],
    ];
    for (const [role, account] of accounts) {
      const preview = await req("GET", `/api/v1/invitations/${token}`, {
        cookies: account.cookies,
      });
      expect(preview.status, `${role} preview`).toBe(404);
      const accepted = await req(
        "POST",
        `/api/v1/invitations/${token}/accept`,
        { cookies: account.cookies },
      );
      expect(accepted.status, `${role} accept`).toBe(404);
    }
    // Acceptance is session-gated first, as every session route is.
    expect(
      (await req("POST", `/api/v1/invitations/${token}/accept`)).status,
    ).toBe(401);

    expect(
      (await inbox()).some((row) => row.id === created.invitation.id),
    ).toBe(false);

    // The inbox filters the collection itself, not only the status: a
    // pending row written by some path that bypassed the owner check must
    // not surface either.
    const stray = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: invitee.email,
    });
    expect((await inbox()).some((row) => row.id === stray.id)).toBe(false);
  });

  it("answers not-found on every address, for the owner, a collaborator and a visitor", async () => {
    const fixture = await collectionWithMedia("Gone Wall");
    const { cid, aid, deletedAid, photoKey, documentKey } = fixture;
    const paths = {
      collection: collectionPath(cid),
      list: `${collectionPath(cid)}/artworks`,
      work: `${collectionPath(cid)}/artworks/${aid}`,
      deleted: `${collectionPath(cid)}/deleted-artworks`,
    };

    // Before the delete: the public work serves, the document is the
    // members' 403, and the Deleted view lists the stamped work.
    expect((await req("GET", mediaUrl(photoKey))).status).toBe(200);
    expect(
      (
        await req("GET", mediaUrl(documentKey), {
          cookies: stranger.cookies,
        })
      ).status,
    ).toBe(403);
    const deletedView = await json<{ id: string }[]>(
      await req("GET", paths.deleted, { cookies: owner.cookies }),
    );
    expect(deletedView.map((work) => work.id)).toEqual([deletedAid]);

    expect(
      (await req("DELETE", paths.collection, { cookies: owner.cookies }))
        .status,
    ).toBe(204);

    // Every address that named the collection, for every caller that can
    // hold one. The signed-in visitor is the session-less visitor's case on
    // the session-gated routes.
    const accounts: [string, Account][] = [
      ["owner", owner],
      ["collaborator", mate],
      ["visitor", stranger],
    ];
    for (const [role, account] of accounts) {
      const calls: [string, Response][] = [
        [
          "collection read",
          await req("GET", paths.collection, { cookies: account.cookies }),
        ],
        [
          "settings write",
          await req("PATCH", paths.collection, {
            cookies: account.cookies,
            body: { name: "A Renamed Ghost" },
          }),
        ],
        [
          "artwork list",
          await req("GET", paths.list, { cookies: account.cookies }),
        ],
        [
          "single work",
          await req("GET", paths.work, { cookies: account.cookies }),
        ],
        [
          "Deleted view",
          await req("GET", paths.deleted, { cookies: account.cookies }),
        ],
        [
          "photo",
          await req("GET", mediaUrl(photoKey), { cookies: account.cookies }),
        ],
        [
          "document",
          await req("GET", mediaUrl(documentKey), {
            cookies: account.cookies,
          }),
        ],
      ];
      for (const [what, res] of calls) {
        expect(res.status, `${role}: ${what}`).toBe(404);
      }
    }

    // The anonymous half: the reads that take no session answer the same,
    // which is the PDF's route into the collection as well (the export is
    // client-side and reads through these two endpoints).
    const anonymous: [string, Response][] = [
      ["collection read", await req("GET", paths.collection)],
      ["artwork list", await req("GET", paths.list)],
      ["single work", await req("GET", paths.work)],
      ["photo", await req("GET", mediaUrl(photoKey))],
      ["document", await req("GET", mediaUrl(documentKey))],
    ];
    for (const [what, res] of anonymous) {
      expect(res.status, `anonymous: ${what}`).toBe(404);
    }

    // The session gate still answers first on the routes that require one:
    // that is the app-wide contract and deletion does not change it.
    expect(
      (await req("PATCH", paths.collection, { body: { name: "Ghost" } }))
        .status,
    ).toBe(401);
    expect((await req("GET", paths.deleted)).status).toBe(401);
  });

  it("keeps the works, their media, the collaborator rows and the works' own stamps", async () => {
    const fixture = await collectionWithMedia("Preserved Wall");
    const { cid, aid, namespace, photoId, documentId } = fixture;

    const snapshot = (
      rows: { id: string; deletedAt: Date | null; updatedAt: Date | null }[],
    ) =>
      rows
        .map((row) => ({
          id: row.id,
          deletedAt: row.deletedAt?.toISOString() ?? null,
          updatedAt: row.updatedAt?.toISOString() ?? null,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

    const artworksBefore = await db
      .select()
      .from(artworksTable)
      .where(eq(artworksTable.collectionId, cid));
    const photosBefore = await db
      .select()
      .from(artworkPhotosTable)
      .where(eq(artworkPhotosTable.artworkId, aid));
    const documentsBefore = await db
      .select()
      .from(artworkDocumentsTable)
      .where(eq(artworkDocumentsTable.artworkId, aid));
    const photoObjects = (
      await listObjects(finalPhotoPrefix(namespace, cid, aid, photoId))
    ).sort();
    const documentObjects = (
      await listObjects(finalDocumentPrefix(namespace, cid, aid, documentId))
    ).sort();
    expect(photoObjects.length).toBeGreaterThan(0);
    expect(documentObjects.length).toBeGreaterThan(0);
    expect(artworksBefore).toHaveLength(2);
    expect(
      artworksBefore.find((row) => row.id === fixture.deletedAid)?.deletedAt,
    ).toBeInstanceOf(Date);

    expect(
      (await req("DELETE", collectionPath(cid), { cookies: owner.cookies }))
        .status,
    ).toBe(204);

    // The collection row is the one thing that moved: stamped, otherwise as
    // it was (which is what makes the operator's restore one column).
    const [collection] = await db
      .select()
      .from(collectionsTable)
      .where(eq(collectionsTable.id, cid));
    expect(collection.deletedAt).toBeInstanceOf(Date);
    expect(collection.name).toBe("Preserved Wall");
    expect(collection.userId).toBe(owner.userId);

    // The works and their children are untouched, the deleted work's own
    // stamp included.
    expect(
      snapshot(
        await db
          .select()
          .from(artworksTable)
          .where(eq(artworksTable.collectionId, cid)),
      ),
    ).toEqual(snapshot(artworksBefore));
    expect(
      await db
        .select()
        .from(artworkPhotosTable)
        .where(eq(artworkPhotosTable.artworkId, aid)),
    ).toHaveLength(photosBefore.length);
    expect(
      await db
        .select()
        .from(artworkDocumentsTable)
        .where(eq(artworkDocumentsTable.artworkId, aid)),
    ).toHaveLength(documentsBefore.length);

    // The sharing record survives: a restore resumes the collaborator.
    expect(
      await db
        .select()
        .from(collaboratorsTable)
        .where(eq(collaboratorsTable.collectionId, cid)),
    ).toHaveLength(1);

    // No storage is reclaimed: every final object is still in the bucket.
    expect(
      (
        await listObjects(finalPhotoPrefix(namespace, cid, aid, photoId))
      ).sort(),
    ).toEqual(photoObjects);
    expect(
      (
        await listObjects(finalDocumentPrefix(namespace, cid, aid, documentId))
      ).sort(),
    ).toEqual(documentObjects);
  });

  it("frees the tier slot immediately, so the capped account can create again", async () => {
    const capped = await freshUser("DeleteCapped");
    const create = (name: string) =>
      req("POST", "/api/v1/collections", {
        cookies: capped.cookies,
        body: { name },
      });

    const first = await create("The Only Wall");
    expect(first.status).toBe(201);
    const firstId = (await json<{ id: string }>(first)).id;

    const blocked = await create("Second Wall");
    expect(blocked.status).toBe(409);
    expect((await err(blocked)).code).toBe("limit-reached");

    expect(
      (
        await req("DELETE", collectionPath(firstId), {
          cookies: capped.cookies,
        })
      ).status,
    ).toBe(204);

    const created = await create("Second Wall");
    expect(created.status).toBe(201);
    const createdId = (await json<{ id: string }>(created)).id;

    // The dashboard reads the same filtered list: one live owned collection,
    // and the deleted one is not it.
    const dashboard = await json<{ id: string; role: string }[]>(
      await req("GET", "/api/v1/collections", { cookies: capped.cookies }),
    );
    expect(dashboard.map((row) => row.id)).toEqual([createdId]);
    expect(dashboard[0].role).toBe("owner");
  });

  it("ends the unlock route and closes the Access grants", async () => {
    const cid = await makeCollection(owner.userId, {
      isPublic: true,
      name: "Locked Wall",
    });
    expect(
      (
        await req("PATCH", collectionPath(cid), {
          cookies: owner.cookies,
          body: { password: "open-sesame" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await req("POST", `${collectionPath(cid)}/unlock`, {
          body: { password: "open-sesame" },
        })
      ).status,
    ).toBe(201);
    expect(
      await db
        .select()
        .from(grantsTable)
        .where(eq(grantsTable.collectionId, cid)),
    ).toHaveLength(1);

    expect(
      (await req("DELETE", collectionPath(cid), { cookies: owner.cookies }))
        .status,
    ).toBe(204);

    // The transaction closed the grants, and the route that mints them no
    // longer knows the collection — for any caller, the owner included.
    expect(
      await db
        .select()
        .from(grantsTable)
        .where(eq(grantsTable.collectionId, cid)),
    ).toHaveLength(0);
    for (const [role, account] of [
      ["anonymous", null],
      ["owner", owner],
      ["collaborator", mate],
      ["visitor", stranger],
    ] as [string, Account | null][]) {
      const after = await req("POST", `${collectionPath(cid)}/unlock`, {
        cookies: account?.cookies,
        body: { password: "open-sesame" },
      });
      expect(after.status, `${role} unlock`).toBe(404);
      expect((await err(after)).code).toBe("not-found");
    }
  });
});
