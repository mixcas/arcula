// Collection search over HTTP against the real stack: the member-only `q` on
// the live artwork list, the gate in front of it, the filter behind it, and the
// caps around it.
//
// The predicate's permutations — accents, punctuation, the ten fields, the
// acquisition date's two forms — are asserted exhaustively in
// packages/shared/tests/artworkSearch.test.ts. What is only visible here is the
// wiring: who may search, which works come back, and what the wire says when
// the answer is empty or refused.

import {
  artworks as artworksTable,
  collectionCollaborators as collaboratorsTable,
  collections as collectionsTable,
} from "@arcula/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ArtworkRead } from "@arcula/shared";
import { grantCookieName } from "../src/collectionGrants";
import { closeDb, db } from "../src/db";
import { err, freshUser, json, req, uuid } from "./helpers/api";

const PASSWORD = "open-sesame";

let owner: { cookies: string; userId: string };
let collaborator: { cookies: string; userId: string };
let stranger: { cookies: string; userId: string };

let cid = "";
let foreignCollectionId = "";
let protectedId = "";

/** Published, matches "blue", "picasso", "canvas", "coastal", "circa". */
let bluePicassoId = "";
/** A draft: a member's search includes it. */
let blueDraftId = "";
/** Deleted: never a candidate, member or not. */
let blueDeletedId = "";
/** Carries the acquisition date and a provenance note. */
let dateId = "";
/** A work that matches none of the distinguishing queries. */
let nonMatchingId = "";
/** Accents in title and artist, and a place of origin. */
let accentedId = "";
/** Another collection's work: a search never reaches across. */
let foreignWorkId = "";
/** The only work in the protected collection. */
let protectedWorkId = "";

interface WorkValues {
  title: string;
  artistName?: string;
  serie?: string;
  media?: string;
  editions?: string;
  dateOfCreation?: string;
  acquisitionDate?: string;
  placeOfOrigin?: string;
  provenance?: string;
  notes?: string;
  dimensions?: string;
  status?: "draft" | "published";
  deleted?: boolean;
  createdAt: Date;
}

async function insertWork(
  collectionId: string,
  userId: string,
  values: WorkValues,
): Promise<string> {
  const id = uuid();
  await db.insert(artworksTable).values({
    id,
    userId,
    collectionId,
    title: values.title,
    artistName: values.artistName ?? values.title,
    serie: values.serie ?? null,
    media: values.media ?? null,
    editions: values.editions ?? null,
    dateOfCreation: values.dateOfCreation ?? null,
    acquisitionDate: values.acquisitionDate ?? null,
    placeOfOrigin: values.placeOfOrigin ?? null,
    provenance: values.provenance ?? null,
    notes: values.notes ?? null,
    dimensions: values.dimensions ?? null,
    status: values.status ?? "published",
    deletedAt: values.deleted ? new Date("2026-02-01T00:00:00.000Z") : null,
    createdAt: values.createdAt,
    updatedAt: values.createdAt,
  });
  return id;
}

const listPath = (collectionId = cid) =>
  `/api/v1/collections/${collectionId}/artworks`;

/** The list address for a committed search, encoded as a browser would. */
const searchPath = (query: string, collectionId = cid) =>
  `${listPath(collectionId)}?q=${encodeURIComponent(query)}`;

/** The ids of a successful list answer. */
async function idsOf(res: Response): Promise<string[]> {
  expect(res.status).toBe(200);
  return (await json<ArtworkRead[]>(res)).map((work) => work.id);
}

beforeAll(async () => {
  owner = await freshUser("SearchOwner");
  collaborator = await freshUser("SearchMate");
  stranger = await freshUser("SearchOther");

  const now = new Date();
  cid = uuid();
  await db.insert(collectionsTable).values({
    id: cid,
    userId: owner.userId,
    mediaNamespaceId: uuid(),
    name: "The Searchable Wall",
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(collaboratorsTable).values({
    collectionId: cid,
    userId: collaborator.userId,
  });

  // Creation time is the live list's order, so each work gets a distinct one.
  bluePicassoId = await insertWork(cid, owner.userId, {
    title: "Blue Harbour",
    artistName: "Pablo Picasso",
    serie: "Coastal Studies",
    media: "Oil on canvas",
    editions: "Edition 7 of 25",
    dateOfCreation: "circa 1889",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  blueDraftId = await insertWork(cid, owner.userId, {
    title: "Blue Study",
    artistName: "P. Picasso",
    status: "draft",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
  });
  blueDeletedId = await insertWork(cid, owner.userId, {
    title: "Blue Ghost",
    artistName: "Pablo Picasso",
    deleted: true,
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
  });
  dateId = await insertWork(cid, owner.userId, {
    title: "Nocturne",
    artistName: "J. Whistler",
    acquisitionDate: "2023-03-05",
    provenance: "Bought at auction, spring 2019",
    createdAt: new Date("2026-01-04T00:00:00.000Z"),
  });
  nonMatchingId = await insertWork(cid, owner.userId, {
    title: "Red Field",
    artistName: "Claude Monet",
    notes: "Needs conservation",
    createdAt: new Date("2026-01-05T00:00:00.000Z"),
  });
  accentedId = await insertWork(cid, owner.userId, {
    title: "Cézanne Study",
    artistName: "Salvador Dalí",
    placeOfOrigin: "Málaga",
    createdAt: new Date("2026-01-06T00:00:00.000Z"),
  });

  foreignCollectionId = uuid();
  await db.insert(collectionsTable).values({
    id: foreignCollectionId,
    userId: stranger.userId,
    mediaNamespaceId: uuid(),
    name: "Someone Else's Wall",
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  });
  foreignWorkId = await insertWork(foreignCollectionId, stranger.userId, {
    title: "Blue Elsewhere",
    createdAt: new Date("2026-01-07T00:00:00.000Z"),
  });

  protectedId = uuid();
  await db.insert(collectionsTable).values({
    id: protectedId,
    userId: owner.userId,
    mediaNamespaceId: uuid(),
    name: "The Protected Search",
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  });
  protectedWorkId = await insertWork(protectedId, owner.userId, {
    title: "Blue Lantern",
    createdAt: new Date("2026-01-08T00:00:00.000Z"),
  });
  const protectedWrite = await req(
    "PATCH",
    `/api/v1/collections/${protectedId}`,
    { cookies: owner.cookies, body: { password: PASSWORD } },
  );
  expect(protectedWrite.status).toBe(200);
});

afterAll(async () => {
  await closeDb();
});

describe("a member's search", () => {
  it("returns only the matching live works, drafts included and deleted excluded", async () => {
    const res = await req("GET", searchPath("blue"), {
      cookies: owner.cookies,
    });
    // The draft matches; the deleted work and the foreign collection's work do
    // not appear. Order is the list's own creation order.
    const ids = await idsOf(res);
    expect(ids).toEqual([bluePicassoId, blueDraftId]);
    expect(ids).not.toContain(blueDeletedId);
    expect(ids).not.toContain(foreignWorkId);
  });

  it("gives a collaborator the same results", async () => {
    const res = await req("GET", searchPath("blue"), {
      cookies: collaborator.cookies,
    });
    expect(await idsOf(res)).toEqual([bluePicassoId, blueDraftId]);
  });

  it("ignores case and punctuation, and requires every term across fields", async () => {
    // "PICASSO, harbour" is two terms in two fields; the draft has Picasso but
    // no "harbour", and the Monet has neither.
    const res = await req("GET", searchPath("PICASSO, harbour"), {
      cookies: owner.cookies,
    });
    expect(await idsOf(res)).toEqual([bluePicassoId]);
  });

  it("ignores accents", async () => {
    const res = await req("GET", searchPath("dali"), {
      cookies: owner.cookies,
    });
    expect(await idsOf(res)).toEqual([accentedId]);
  });

  it("finds the works by each of the ten fields", async () => {
    const cases: [query: string, expected: string][] = [
      ["harbour", bluePicassoId],
      ["picasso", bluePicassoId],
      ["coastal", bluePicassoId],
      ["canvas", bluePicassoId],
      ["edition", bluePicassoId],
      ["circa", bluePicassoId],
      ["2023", dateId],
      ["malaga", accentedId],
      ["auction", dateId],
      ["conservation", nonMatchingId],
    ];

    for (const [query, expected] of cases) {
      const res = await req("GET", searchPath(query), {
        cookies: owner.cookies,
      });
      expect(await idsOf(res), `search for "${query}"`).toContain(expected);
    }
  });

  it("matches an acquisition date by year, month and long form", async () => {
    for (const query of ["2023", "march", "March 5, 2023", "2023-03-05"]) {
      const res = await req("GET", searchPath(query), {
        cookies: owner.cookies,
      });
      expect(await idsOf(res), `search for "${query}"`).toEqual([dateId]);
    }
  });

  it("answers a successful empty list when nothing matches", async () => {
    const res = await req("GET", searchPath("xyzzy plugh"), {
      cookies: owner.cookies,
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual([]);
  });

  it("does not reach across collections", async () => {
    const own = await req("GET", searchPath("elsewhere"), {
      cookies: owner.cookies,
    });
    expect(await idsOf(own)).toEqual([]);

    const foreign = await req(
      "GET",
      searchPath("elsewhere", foreignCollectionId),
      { cookies: stranger.cookies },
    );
    expect(await idsOf(foreign)).toEqual([foreignWorkId]);
  });
});

describe("an absent, empty or whitespace-only query", () => {
  it("leaves the list exactly as it was without one", async () => {
    const plain = await req("GET", listPath(), { cookies: owner.cookies });
    const expected = [
      bluePicassoId,
      blueDraftId,
      dateId,
      nonMatchingId,
      accentedId,
    ];
    expect(await idsOf(plain)).toEqual(expected);

    for (const query of ["", "   ", "  \t "]) {
      const res = await req("GET", searchPath(query), {
        cookies: owner.cookies,
      });
      expect(await idsOf(res), `q=${JSON.stringify(query)}`).toEqual(expected);
    }
  });
});

describe("the member-only gate", () => {
  it("answers 401 to a caller with no session", async () => {
    const res = await req("GET", searchPath("blue"));
    expect(res.status).toBe(401);
    expect((await err(res)).code).toBe("unauthorized");
  });

  it("answers 403 to a signed-in non-member of a public collection", async () => {
    const res = await req("GET", searchPath("blue"), {
      cookies: stranger.cookies,
    });
    expect(res.status).toBe(403);
    expect((await err(res)).code).toBe("forbidden");
  });

  it("answers 403 to a signed-in non-member holding a valid Access grant", async () => {
    // The grant admits the ordinary visitor read — published, live works —
    // and buys nothing for the member facility.
    const unlocked = await req(
      "POST",
      `/api/v1/collections/${protectedId}/unlock`,
      { body: { password: PASSWORD } },
    );
    expect(unlocked.status).toBe(201);
    const grant = unlocked.headers
      .getSetCookie()
      .find((header) => header.startsWith(`${grantCookieName(protectedId)}=`));
    expect(grant).toBeDefined();
    const grantCookie = grant!.split(";")[0];

    const ordinary = await req("GET", listPath(protectedId), {
      cookies: grantCookie,
    });
    expect(await idsOf(ordinary)).toEqual([protectedWorkId]);

    // The grant is not a session: with no account the search is still 401.
    const anonymous = await req("GET", searchPath("lantern", protectedId), {
      cookies: grantCookie,
    });
    expect(anonymous.status).toBe(401);
    expect((await err(anonymous)).code).toBe("unauthorized");

    // Signed in, grant held, still not a member: 403.
    const searched = await req("GET", searchPath("lantern", protectedId), {
      cookies: `${stranger.cookies}; ${grantCookie}`,
    });
    expect(searched.status).toBe(403);
    expect((await err(searched)).code).toBe("forbidden");
  });

  it("answers 404 for a missing collection, before the session question", async () => {
    // There is nothing to search, so the missing collection is the answer for
    // a member and an anonymous caller alike.
    for (const cookies of [owner.cookies, undefined]) {
      const res = await req("GET", searchPath("blue", uuid()), { cookies });
      expect(res.status).toBe(404);
      expect((await err(res)).code).toBe("not-found");
    }
  });

  it("answers the access question before the query caps", async () => {
    const overCap = Array.from({ length: 11 }, (_, i) => `nope${i}`).join(" ");

    // A missing collection is the answer even when the query is also invalid:
    // there is nothing to validate against.
    for (const cookies of [owner.cookies, undefined]) {
      const res = await req("GET", searchPath(overCap, uuid()), { cookies });
      expect(res.status).toBe(404);
    }

    // An anonymous over-cap query is an identity refusal, not a validation
    // one — the member facility is not usable from outside.
    const anonymous = await req("GET", searchPath(overCap));
    expect(anonymous.status).toBe(401);
    expect((await err(anonymous)).code).toBe("unauthorized");

    // A signed-in non-member is refused for the same reason before the caps.
    const strangerRes = await req("GET", searchPath(overCap), {
      cookies: stranger.cookies,
    });
    expect(strangerRes.status).toBe(403);
    expect((await err(strangerRes)).code).toBe("forbidden");
  });
});

describe("the shared caps", () => {
  it("allows 200 characters and ten terms", async () => {
    const atLength = await req("GET", searchPath("a".repeat(200)), {
      cookies: owner.cookies,
    });
    expect(await idsOf(atLength)).toEqual([]);

    const tenTerms = Array.from({ length: 10 }, (_, i) => `nope${i}`).join(" ");
    const atTerms = await req("GET", searchPath(tenTerms), {
      cookies: owner.cookies,
    });
    expect(await idsOf(atTerms)).toEqual([]);
  });

  it("answers 400 validation attributed to q past 200 characters", async () => {
    const res = await req("GET", searchPath("a".repeat(201)), {
      cookies: owner.cookies,
    });
    expect(res.status).toBe(400);
    const body = await err(res);
    expect(body.code).toBe("validation");
    expect(body.fields?.q).toBeTruthy();
  });

  it("answers 400 validation attributed to q past ten terms", async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `nope${i}`).join(" ");
    const res = await req("GET", searchPath(eleven), {
      cookies: owner.cookies,
    });
    expect(res.status).toBe(400);
    const body = await err(res);
    expect(body.code).toBe("validation");
    expect(body.fields?.q).toBeTruthy();
  });
});
