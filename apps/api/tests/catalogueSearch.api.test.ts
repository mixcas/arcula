// Catalogue search over HTTP against the real stack: the member-only `q` on
// the live artwork list, the gate in front of it, the filter behind it, the
// caps around it, and the structured query — filters, sort, paging, facets and
// the page envelope — on the same read.
//
// The predicate's and the query's permutations — accents, punctuation, the ten
// fields, the acquisition date's two forms, OR within a field, the sort's total
// order, facet counting above 500 values — are asserted exhaustively in
// packages/shared/tests/artworkSearch.test.ts. What is only visible here is the
// wiring: who may search, which works come back, what the wire says when the
// answer is empty or refused, and that a page never skips or repeats a row.

import {
  artworks as artworksTable,
  catalogueCollaborators as collaboratorsTable,
  catalogues as cataloguesTable,
} from "@arcula/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ArtworkAvailability,
  ArtworkPage,
  ArtworkRead,
} from "@arcula/shared";
import { grantCookieName } from "../src/catalogueGrants";
import { closeDb, db } from "../src/db";
import { err, freshUser, json, listedArtworks, req, uuid } from "./helpers/api";

const PASSWORD = "open-sesame";
const RUN = Math.random().toString(36).slice(2, 8);

let owner: { cookies: string; userId: string };
let collaborator: { cookies: string; userId: string };
let stranger: { cookies: string; userId: string };

let cid = "";
let foreignCatalogueId = "";
let protectedId = "";
let sortCid = "";

/** Published, matches "blue", "picasso", "canvas", "coastal", "circa". */
let bluePicassoId = "";
/** A draft: a member's search includes it. */
let blueDraftId = "";
/** Deleted: never a candidate, member or not. */
let blueDeletedId = "";
/** Carries the acquisition date, a provenance note and a sold state. */
let dateId = "";
/** A Monet, available, with a note that is the only place "conservation" says anything. */
let nonMatchingId = "";
/** Accents in title and artist, and a place of origin. */
let accentedId = "";
/** Another catalogue's work: a search never reaches across. */
let foreignWorkId = "";
/** The only work in the protected catalogue. */
let protectedWorkId = "";

/** The sort catalogue's four works, by the ids whose order the tiebreaks prove. */
let sortIds: {
  alpha: string;
  alphaAccented: string;
  beta: string;
  zeta: string;
} = { alpha: "", alphaAccented: "", beta: "", zeta: "" };

interface WorkValues {
  id?: string;
  title: string;
  artistName?: string;
  serie?: string;
  medium?: string;
  editions?: string;
  dateOfCreation?: string;
  acquisitionDate?: string;
  placeOfOrigin?: string;
  provenance?: string;
  notes?: string;
  dimensions?: string;
  status?: "draft" | "published";
  availability?: ArtworkAvailability | null;
  deleted?: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

async function insertWork(
  catalogueId: string,
  userId: string,
  values: WorkValues,
): Promise<string> {
  const id = values.id ?? uuid();
  await db.insert(artworksTable).values({
    id,
    userId,
    catalogueId,
    title: values.title,
    artistName: values.artistName ?? values.title,
    serie: values.serie ?? null,
    medium: values.medium ?? null,
    editions: values.editions ?? null,
    dateOfCreation: values.dateOfCreation ?? null,
    acquisitionDate: values.acquisitionDate ?? null,
    placeOfOrigin: values.placeOfOrigin ?? null,
    provenance: values.provenance ?? null,
    notes: values.notes ?? null,
    dimensions: values.dimensions ?? null,
    status: values.status ?? "published",
    availability: values.availability ?? null,
    deletedAt: values.deleted ? new Date("2026-02-01T00:00:00.000Z") : null,
    createdAt: values.createdAt,
    updatedAt: values.updatedAt ?? values.createdAt,
  });
  return id;
}

const listPath = (catalogueId = cid) =>
  `/api/v1/catalogues/${catalogueId}/artworks`;

/** A list address with raw query parameters, encoded as a browser would. */
const queryPath = (params: Record<string, string | string[]>, id = cid) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const one of Array.isArray(value) ? value : [value]) {
      search.append(key, one);
    }
  }
  const encoded = search.toString();
  return encoded === "" ? listPath(id) : `${listPath(id)}?${encoded}`;
};

/** The list address for a committed free-text search. */
const searchPath = (query: string, catalogueId = cid) =>
  queryPath({ q: query }, catalogueId);

/** The ids of a successful list answer, in wire order. */
async function idsOf(res: Response): Promise<string[]> {
  expect(res.status).toBe(200);
  return (await listedArtworks(res)).map((work) => work.id);
}

/** The page envelope of a successful list answer, asserting the status first. */
async function pageOf(res: Response): Promise<ArtworkPage> {
  expect(res.status).toBe(200);
  return json<ArtworkPage>(res);
}

beforeAll(async () => {
  owner = await freshUser("SearchOwner");
  collaborator = await freshUser("SearchMate");
  stranger = await freshUser("SearchOther");

  const now = new Date();
  cid = uuid();
  await db.insert(cataloguesTable).values({
    id: cid,
    userId: owner.userId,
    mediaNamespaceId: uuid(),
    name: "The Searchable Wall",
    // These search cases filter and facet on Availability, Serie, Editions and
    // Place of origin, which a Collection's defaults leave off.
    artworkFields: {
      availability: true,
      serie: true,
      editions: true,
      placeOfOrigin: true,
    },
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(collaboratorsTable).values({
    catalogueId: cid,
    userId: collaborator.userId,
  });

  // Updated time is the list's default order, so each work gets a distinct one.
  bluePicassoId = await insertWork(cid, owner.userId, {
    title: "Blue Harbour",
    artistName: "Pablo Picasso",
    serie: "Coastal Studies",
    medium: "Oil on canvas",
    editions: "Edition 7 of 25",
    dateOfCreation: "circa 1889",
    availability: "available",
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
    availability: "sold",
    createdAt: new Date("2026-01-04T00:00:00.000Z"),
  });
  nonMatchingId = await insertWork(cid, owner.userId, {
    title: "Red Field",
    artistName: "Claude Monet",
    notes: "Needs conservation",
    availability: "available",
    createdAt: new Date("2026-01-05T00:00:00.000Z"),
  });
  accentedId = await insertWork(cid, owner.userId, {
    title: "Cézanne Study",
    artistName: "Salvador Dalí",
    placeOfOrigin: "Málaga",
    createdAt: new Date("2026-01-06T00:00:00.000Z"),
  });

  foreignCatalogueId = uuid();
  await db.insert(cataloguesTable).values({
    id: foreignCatalogueId,
    userId: stranger.userId,
    mediaNamespaceId: uuid(),
    name: "Someone Else's Wall",
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  });
  foreignWorkId = await insertWork(foreignCatalogueId, stranger.userId, {
    title: "Blue Elsewhere",
    createdAt: new Date("2026-01-07T00:00:00.000Z"),
  });

  protectedId = uuid();
  await db.insert(cataloguesTable).values({
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
    `/api/v1/catalogues/${protectedId}`,
    { cookies: owner.cookies, body: { password: PASSWORD } },
  );
  expect(protectedWrite.status).toBe(200);

  // The sort catalogue: two works share an updated time and two share a
  // normalized title, so only the id tiebreak can order them. The ids sort in
  // the alphabetical order the expectations name them in.
  sortCid = uuid();
  await db.insert(cataloguesTable).values({
    id: sortCid,
    userId: owner.userId,
    mediaNamespaceId: uuid(),
    name: "The Ordered Wall",
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  });
  sortIds = {
    alpha: await insertWork(sortCid, owner.userId, {
      id: `a${RUN}`,
      title: "alpha",
      artistName: "Dalí",
      dateOfCreation: "circa 1850",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    }),
    alphaAccented: await insertWork(sortCid, owner.userId, {
      id: `b${RUN}`,
      title: "Álpha",
      artistName: "Picasso",
      dateOfCreation: "1850",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }),
    beta: await insertWork(sortCid, owner.userId, {
      id: `c${RUN}`,
      title: "Beta",
      artistName: "Monet",
      dateOfCreation: "1900",
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
    zeta: await insertWork(sortCid, owner.userId, {
      id: `d${RUN}`,
      title: "zeta",
      artistName: "Cézanne",
      createdAt: new Date("2026-01-04T00:00:00.000Z"),
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    }),
  };
});

afterAll(async () => {
  await closeDb();
});

describe("a member's search", () => {
  it("returns only the matching live works, drafts included and deleted excluded", async () => {
    const res = await req("GET", queryPath({ q: "blue", sort: "title" }), {
      cookies: owner.cookies,
    });
    // The draft matches; the deleted work and the foreign catalogue's work do
    // not appear.
    const ids = await idsOf(res);
    expect(ids).toEqual([bluePicassoId, blueDraftId]);
    expect(ids).not.toContain(blueDeletedId);
    expect(ids).not.toContain(foreignWorkId);
  });

  it("gives a collaborator the same results", async () => {
    const res = await req("GET", queryPath({ q: "blue", sort: "title" }), {
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

  it("answers an empty page when nothing matches", async () => {
    const res = await req("GET", searchPath("xyzzy plugh"), {
      cookies: owner.cookies,
    });
    expect(await pageOf(res)).toEqual({
      artworks: [],
      total: 0,
      limit: null,
      offset: 0,
    });
  });

  it("does not reach across catalogues", async () => {
    const own = await req("GET", searchPath("elsewhere"), {
      cookies: owner.cookies,
    });
    expect(await idsOf(own)).toEqual([]);

    const foreign = await req(
      "GET",
      searchPath("elsewhere", foreignCatalogueId),
      { cookies: stranger.cookies },
    );
    expect(await idsOf(foreign)).toEqual([foreignWorkId]);
  });
});

describe("a catalogue's enabled fields", () => {
  it("finds text in a recorded field and not the same text in a disabled one", async () => {
    const narrowId = uuid();
    const createdAt = new Date("2026-03-01T00:00:00.000Z");
    await db.insert(cataloguesTable).values({
      id: narrowId,
      userId: owner.userId,
      mediaNamespaceId: uuid(),
      name: "The Narrow Record",
      isPublic: true,
      artworkFields: { provenance: false },
      createdAt,
      updatedAt: createdAt,
    });
    const disabledField = await insertWork(narrowId, owner.userId, {
      title: "Hidden Provenance",
      artistName: "Ana",
      provenance: "auction",
      createdAt,
    });
    const enabledField = await insertWork(narrowId, owner.userId, {
      title: "Sibling Record",
      artistName: "Ana",
      medium: "auction",
      createdAt: new Date(createdAt.getTime() + 1),
    });

    // The same word lives in a disabled field and an enabled one: only the
    // recorded field contributes it to the search.
    const recorded = await req("GET", searchPath("auction", narrowId), {
      cookies: owner.cookies,
    });
    expect(await idsOf(recorded)).toEqual([enabledField]);

    // Title is never taken away, so the disabled-field work is still found by
    // its own name.
    const byTitle = await req("GET", searchPath("provenance", narrowId), {
      cookies: owner.cookies,
    });
    expect(await idsOf(byTitle)).toEqual([disabledField]);
  });
});

describe("an absent, empty or whitespace-only query", () => {
  it("leaves the list exactly as it was without one", async () => {
    const plain = await req("GET", listPath(), { cookies: owner.cookies });
    // The default order is most recently updated first.
    const expected = [
      accentedId,
      nonMatchingId,
      dateId,
      blueDraftId,
      bluePicassoId,
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

  it("answers 403 to a signed-in non-member of a public catalogue", async () => {
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
      `/api/v1/catalogues/${protectedId}/unlock`,
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

  it("answers 404 for a missing catalogue, before the session question", async () => {
    // There is nothing to search, so the missing catalogue is the answer for
    // a member and an anonymous caller alike.
    for (const cookies of [owner.cookies, undefined]) {
      const res = await req("GET", searchPath("blue", uuid()), { cookies });
      expect(res.status).toBe(404);
      expect((await err(res)).code).toBe("not-found");
    }
  });

  it("answers the access question before the query caps", async () => {
    const overCap = Array.from({ length: 11 }, (_, i) => `nope${i}`).join(" ");

    // A missing catalogue is the answer even when the query is also invalid:
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

  it("answers the access question before a structured query's validity", async () => {
    // A visitor on a private catalogue is refused, not instructed about
    // `offset`; the same request on a public catalogue is a validation error.
    const malformed = queryPath({ offset: "1" });
    const hidden = await req(
      "GET",
      malformed.replace(listPath(cid), listPath(protectedId)),
      { cookies: stranger.cookies },
    );
    expect(hidden.status).toBe(403);
    const own = await req("GET", malformed, { cookies: owner.cookies });
    expect(own.status).toBe(400);
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

describe("the structured filters", () => {
  it("means either value within a field", async () => {
    const res = await req(
      "GET",
      queryPath({
        artistName: ["Picasso", "Monet"],
        sort: "title",
      }),
      { cookies: owner.cookies },
    );
    // Both Picassos (the draft's "P. Picasso" included) and the Monet; the
    // deleted work is still not a candidate.
    expect(await idsOf(res)).toEqual([
      bluePicassoId,
      blueDraftId,
      nonMatchingId,
    ]);
  });

  it("means every populated field across fields", async () => {
    const res = await req(
      "GET",
      queryPath({
        artistName: ["Matisse", "Picasso"],
        medium: ["canvas"],
        sort: "title",
      }),
      { cookies: owner.cookies },
    );
    // The artist matches both Picassos, the medium only the oil — so the
    // draft, which has no medium, is out.
    expect(await idsOf(res)).toEqual([bluePicassoId]);
  });

  it("normalizes text and matches it within the named field only", async () => {
    const accented = await req("GET", queryPath({ artistName: "DALÍ" }), {
      cookies: owner.cookies,
    });
    expect(await idsOf(accented)).toEqual([accentedId]);

    const place = await req("GET", queryPath({ placeOfOrigin: "malaga" }), {
      cookies: owner.cookies,
    });
    expect(await idsOf(place)).toEqual([accentedId]);

    // "conservation" is in the Monet's notes, not in its title.
    const wrongField = await req("GET", queryPath({ title: "conservation" }), {
      cookies: owner.cookies,
    });
    expect(await pageOf(wrongField)).toMatchObject({ total: 0, artworks: [] });
  });

  it("ignores an empty filter value instead of matching everything or nothing", async () => {
    const res = await req("GET", queryPath({ title: "" }), {
      cookies: owner.cookies,
    });
    expect(await pageOf(res)).toMatchObject({
      total: 5,
    });
  });

  it("compares an enumerated value exactly and refuses one outside the list", async () => {
    const drafts = await req("GET", queryPath({ status: "draft" }), {
      cookies: owner.cookies,
    });
    expect(await idsOf(drafts)).toEqual([blueDraftId]);

    const sold = await req("GET", queryPath({ availability: "sold" }), {
      cookies: owner.cookies,
    });
    expect(await idsOf(sold)).toEqual([dateId]);

    const available = await req(
      "GET",
      queryPath({ availability: "available", sort: "title" }),
      { cookies: owner.cookies },
    );
    expect(await idsOf(available)).toEqual([bluePicassoId, nonMatchingId]);

    // A prefix is not a value: never ignored, always refused.
    const bad = await req("GET", queryPath({ availability: "avail" }), {
      cookies: owner.cookies,
    });
    expect(bad.status).toBe(400);
    const body = await err(bad);
    expect(body.code).toBe("validation");
    expect(body.fields?.availability).toBeTruthy();
  });

  it("ANDs q with the filters", async () => {
    const draft = await req("GET", queryPath({ q: "blue", status: "draft" }), {
      cookies: owner.cookies,
    });
    expect(await idsOf(draft)).toEqual([blueDraftId]);

    const published = await req(
      "GET",
      queryPath({ q: "blue", status: "published" }),
      { cookies: owner.cookies },
    );
    expect(await idsOf(published)).toEqual([bluePicassoId]);
  });

  it("refuses an unknown field, naming it, before answering a page", async () => {
    const res = await req("GET", queryPath({ colour: "red" }), {
      cookies: owner.cookies,
    });
    expect(res.status).toBe(400);
    const body = await err(res);
    expect(body.code).toBe("validation");
    expect(body.fields?.colour).toBeTruthy();
  });

  it("allows 20 values in a field and 8 filter fields, and refuses one more", async () => {
    const atValueCap = await req(
      "GET",
      queryPath({ title: Array.from({ length: 20 }, (_, i) => `v${i}`) }),
      { cookies: owner.cookies },
    );
    expect(atValueCap.status).toBe(200);

    const overValueCap = await req(
      "GET",
      queryPath({ title: Array.from({ length: 21 }, (_, i) => `v${i}`) }),
      { cookies: owner.cookies },
    );
    expect(overValueCap.status).toBe(400);
    expect((await err(overValueCap)).fields?.title).toBeTruthy();

    const fields = [
      "title",
      "artistName",
      "serie",
      "medium",
      "editions",
      "dateOfCreation",
      "acquisitionDate",
      "placeOfOrigin",
    ];
    const atFieldCap = await req(
      "GET",
      queryPath(Object.fromEntries(fields.map((field) => [field, "v"]))),
      { cookies: owner.cookies },
    );
    expect(atFieldCap.status).toBe(200);

    const overFieldCap = await req(
      "GET",
      queryPath(
        Object.fromEntries([...fields, "provenance"].map((f) => [f, "v"])),
      ),
      { cookies: owner.cookies },
    );
    expect(overFieldCap.status).toBe(400);
    expect((await err(overFieldCap)).code).toBe("validation");
  });
});

describe("the page envelope and paging", () => {
  it("answers every match, with the page facts, when no limit was asked for", async () => {
    const page = await pageOf(
      await req("GET", listPath(), { cookies: owner.cookies }),
    );
    expect(page.total).toBe(5);
    expect(page.limit).toBeNull();
    expect(page.offset).toBe(0);
    expect(page.artworks).toHaveLength(5);
  });

  it("answers exactly one page and keeps total whole", async () => {
    const page = await pageOf(
      await req("GET", queryPath({ limit: "2", offset: "2" }), {
        cookies: owner.cookies,
      }),
    );
    expect(page).toMatchObject({ total: 5, limit: 2, offset: 2 });
    expect(page.artworks.map((work) => work.id)).toEqual([dateId, blueDraftId]);
  });

  it("answers an empty page for a limit of zero, with the total intact", async () => {
    const page = await pageOf(
      await req("GET", queryPath({ limit: "0" }), { cookies: owner.cookies }),
    );
    expect(page).toMatchObject({ artworks: [], total: 5, limit: 0, offset: 0 });
  });

  it("refuses a limit past 100, naming limit", async () => {
    const res = await req("GET", queryPath({ limit: "101" }), {
      cookies: owner.cookies,
    });
    expect(res.status).toBe(400);
    const body = await err(res);
    expect(body.code).toBe("validation");
    expect(body.fields?.limit).toBeTruthy();
  });

  it("refuses an offset without a limit, naming the problem on offset", async () => {
    for (const offset of ["0", "10"]) {
      const res = await req("GET", queryPath({ offset }), {
        cookies: owner.cookies,
      });
      expect(res.status, `offset=${offset}`).toBe(400);
      const body = await err(res);
      expect(body.code).toBe("validation");
      expect(body.fields?.offset).toContain("limit");
    }
  });

  it("omits facets unless they were asked for", async () => {
    const page = await pageOf(
      await req("GET", listPath(), { cookies: owner.cookies }),
    );
    expect("facets" in page).toBe(false);
  });

  it("refuses an order outside the four, and a facet that is not a filter", async () => {
    for (const [params, field] of [
      [{ sort: "created" }, "sort"],
      [{ facets: "dimensions" }, "facets"],
    ] as const) {
      const res = await req("GET", queryPath(params), {
        cookies: owner.cookies,
      });
      expect(res.status, JSON.stringify(params)).toBe(400);
      expect((await err(res)).fields?.[field]).toBeTruthy();
    }
  });
});

describe("paging under every sort", () => {
  const sorts = ["updated", "title", "artistName", "dateOfCreation"] as const;

  it("names each sort explicitly and answers the full result in its order", async () => {
    const expected = {
      // The two Jan-3 works tie, and their ids order them.
      updated: [
        sortIds.alpha,
        sortIds.zeta,
        sortIds.alphaAccented,
        sortIds.beta,
      ],
      // "alpha" and "Álpha" normalize together; the ids decide.
      title: [sortIds.alpha, sortIds.alphaAccented, sortIds.beta, sortIds.zeta],
      artistName: [
        sortIds.zeta,
        sortIds.alpha,
        sortIds.beta,
        sortIds.alphaAccented,
      ],
      // A missing date sorts as empty, before "1850".
      dateOfCreation: [
        sortIds.zeta,
        sortIds.alphaAccented,
        sortIds.beta,
        sortIds.alpha,
      ],
    };

    for (const sort of sorts) {
      const res = await req("GET", queryPath({ sort }, sortCid), {
        cookies: owner.cookies,
      });
      expect(await idsOf(res), `sort=${sort}`).toEqual(expected[sort]);
    }
  });

  it("never skips or repeats a row when paged, under any sort", async () => {
    for (const sort of sorts) {
      const whole = await idsOf(
        await req("GET", queryPath({ sort }, sortCid), {
          cookies: owner.cookies,
        }),
      );

      for (const limit of ["1", "2", "3"]) {
        const paged: string[] = [];
        for (let offset = 0; offset < whole.length; offset += Number(limit)) {
          const res = await req(
            "GET",
            queryPath({ sort, limit, offset: String(offset) }, sortCid),
            { cookies: owner.cookies },
          );
          paged.push(...(await idsOf(res)));
        }
        expect(paged, `sort=${sort}, limit=${limit}`).toEqual(whole);
      }
    }
  });
});

describe("facet counts", () => {
  it("counts the filtered set, not the page", async () => {
    const page = await pageOf(
      await req("GET", queryPath({ limit: "1", facets: "status" }), {
        cookies: owner.cookies,
      }),
    );
    expect(page.artworks).toHaveLength(1);
    expect(page.total).toBe(5);
    expect(page.facets).toEqual({
      status: [
        { value: "published", count: 4 },
        { value: "draft", count: 1 },
      ],
    });
  });

  it("agrees with the filters the page carried", async () => {
    // Artist names among the works whose medium says oil: only the Picasso.
    const page = await pageOf(
      await req("GET", queryPath({ medium: "oil", facets: "artistName" }), {
        cookies: owner.cookies,
      }),
    );
    expect(page.total).toBe(1);
    expect(page.facets).toEqual({
      artistName: [{ value: "pablo picasso", count: 1 }],
    });
  });

  it("counts an enumerated field by value, skipping a work that has none", async () => {
    const page = await pageOf(
      await req("GET", queryPath({ facets: "availability" }), {
        cookies: owner.cookies,
      }),
    );
    // Every one of the five live works: two available, one sold, and the
    // three without a market state contribute nothing.
    expect(page.facets).toEqual({
      availability: [
        { value: "available", count: 2 },
        { value: "sold", count: 1 },
      ],
    });
  });

  it("asks for several facets at once, each answered independently", async () => {
    const page = await pageOf(
      await req("GET", queryPath({ facets: ["status", "availability"] }), {
        cookies: owner.cookies,
      }),
    );
    expect(Object.keys(page.facets ?? {})).toEqual(["status", "availability"]);
  });
});

describe("a visitor's structured read", () => {
  it("filters published works only, with the same envelope", async () => {
    const page = await pageOf(
      await req("GET", queryPath({ availability: "available" })),
    );
    // The visitor's two available works are published; the draft is absent
    // whatever its fields say.
    expect(page.total).toBe(2);
    expect(page.artworks.map((work) => work.id).sort()).toEqual(
      [bluePicassoId, nonMatchingId].sort(),
    );
    expect(page.artworks.every((work) => work.status === "published")).toBe(
      true,
    );
  });

  it("answers an empty page when the filter names a draft", async () => {
    const page = await pageOf(await req("GET", queryPath({ status: "draft" })));
    expect(page).toMatchObject({ artworks: [], total: 0 });
  });

  it("counts facets over the visitor's own published set", async () => {
    const page = await pageOf(
      await req("GET", queryPath({ facets: "status" })),
    );
    expect(page.facets).toEqual({
      status: [{ value: "published", count: 4 }],
    });
  });

  it("answers the same page with no filters at all", async () => {
    const page = await pageOf(await req("GET", listPath()));
    expect(page.total).toBe(4);
    expect(page.limit).toBeNull();
    expect(page.artworks.every((work) => work.status === "published")).toBe(
      true,
    );
    expect(page.artworks.map((work) => work.id)).not.toContain(blueDraftId);
    expect(page.artworks.map((work) => work.id)).not.toContain(blueDeletedId);
  });
});

describe("a work summary's shape", () => {
  it("is the full read document, never a narrower one", async () => {
    // This route has always answered full documents, and the web renders
    // them. The envelope changed the collection's shape, not a row's.
    const page = await pageOf(
      await req("GET", listPath(), { cookies: owner.cookies }),
    );
    const row = page.artworks.find((work) => work.id === bluePicassoId);
    if (!row) throw new Error("the fixture work is missing");
    expect(row).toEqual(
      await json<ArtworkRead>(
        await req("GET", `${listPath()}/${bluePicassoId}`, {
          cookies: owner.cookies,
        }),
      ),
    );
    expect(row.availability).toBe("available");
  });
});
