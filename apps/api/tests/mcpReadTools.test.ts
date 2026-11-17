// The three read tools at the dispatcher seam: a verified user id and an
// argument bag in, the module a route calls out. No transport, no token, no
// Hono Context.
//
// What is asserted here is the wiring the spec's tool inventory promises and
// nothing the modules underneath already prove: which rows the counts include,
// what a page envelope carries, that a summary has no media on it, and that a
// caller without membership is refused with the app's own words. The parser's
// permutations (accents, the ten fields, OR within a field) are asserted in
// packages/shared/tests/artworkSearch.test.ts; the access verdict is asserted
// in access.test.ts.

import {
  artworks as artworksTable,
  artworkDocuments as artworkDocumentsTable,
  artworkPhotos as artworkPhotosTable,
  artworkPhotoVariants as artworkPhotoVariantsTable,
  catalogueCollaborators as collaboratorsTable,
  catalogues as cataloguesTable,
} from "@arcula/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ArtworkAvailability, ArtworkRead } from "@arcula/shared";
import { closeDb, db } from "../src/db";
import { ApiError } from "../src/errors";
import { dispatchTool } from "../src/mcp/dispatcher";
import { freshUser, uuid } from "./helpers/api";
import { makeCatalogue } from "./helpers/fixtures";

interface CatalogueAnswer {
  id: string;
  name: string;
  kind: string;
  visibility: string;
  passwordProtected?: boolean;
  description?: string;
  role?: string;
  counts: { published: number; draft?: number };
}

const getCatalogue = async (
  userId: string,
  catalogueId: string,
): Promise<CatalogueAnswer> =>
  (await dispatchTool({
    userId,
    name: "get_catalogue",
    args: { catalogueId },
  })) as CatalogueAnswer;

interface WorkValues {
  title: string;
  artistName: string;
  serie?: string;
  medium?: string;
  dateOfCreation?: string;
  status?: "draft" | "published";
  availability?: ArtworkAvailability | null;
  deleted?: boolean;
  updatedAt?: Date;
}

/** A work written straight through drizzle, the way the fixture suites do. */
async function insertWork(
  catalogueId: string,
  userId: string,
  values: WorkValues,
): Promise<string> {
  const id = uuid();
  await db.insert(artworksTable).values({
    id,
    userId,
    catalogueId,
    title: values.title,
    artistName: values.artistName,
    serie: values.serie ?? null,
    medium: values.medium ?? null,
    dateOfCreation: values.dateOfCreation ?? null,
    status: values.status ?? "published",
    availability: values.availability ?? null,
    deletedAt: values.deleted ? new Date("2026-02-01T00:00:00.000Z") : null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: values.updatedAt ?? new Date("2026-01-01T00:00:00.000Z"),
  });
  return id;
}

let owner: { cookies: string; userId: string };
let collaborator: { cookies: string; userId: string };
let stranger: { cookies: string; userId: string };

let studioId = "";
let privateId = "";
let deletedId = "";

/** Studio Inventory's works, by the facts the tools answer with. */
let blueNudeId = "";
let guitarId = "";
let sketchId = "";
/** The member-visible Deleted row `get_artwork` must still refuse. */
let lostWorkId = "";

beforeAll(async () => {
  owner = await freshUser("Owner");
  collaborator = await freshUser("Collaborator");
  stranger = await freshUser("Stranger");

  studioId = await makeCatalogue(owner.userId, {
    name: "Studio Inventory",
    isPublic: true,
    kind: "inventory",
  });
  await db
    .update(cataloguesTable)
    .set({ description: "Works kept in the studio" })
    .where(eq(cataloguesTable.id, studioId));
  privateId = await makeCatalogue(owner.userId, {
    name: "Private Catalogue",
    isPublic: false,
  });
  deletedId = await makeCatalogue(owner.userId, { name: "Deleted Catalogue" });
  await db
    .update(cataloguesTable)
    .set({ deletedAt: new Date("2026-03-01T00:00:00.000Z") })
    .where(eq(cataloguesTable.id, deletedId));
  await db.insert(collaboratorsTable).values({
    catalogueId: studioId,
    userId: collaborator.userId,
  });

  blueNudeId = await insertWork(studioId, owner.userId, {
    title: "Blue Nude",
    artistName: "Henri Matisse",
    medium: "Oil on canvas",
    dateOfCreation: "1907",
    availability: "sold",
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  });
  sketchId = await insertWork(studioId, owner.userId, {
    title: "Sketch for Blue Nude",
    artistName: "Henri Matisse",
    medium: "Charcoal",
    dateOfCreation: "1906",
    status: "draft",
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  });
  guitarId = await insertWork(studioId, owner.userId, {
    title: "Guitar",
    artistName: "Pablo Picasso",
    medium: "Oil on canvas",
    dateOfCreation: "1912",
    availability: "available",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  // Deleted: never in a count, a search or a page, and never answered by id
  // to an agent — the app's Deleted view is not the agent's.
  lostWorkId = await insertWork(studioId, owner.userId, {
    title: "Lost Work",
    artistName: "Henri Matisse",
    medium: "Oil on canvas",
    deleted: true,
  });
  // A photo and a document on one work, for the full record `get_artwork`
  // answers and the summary `search_artworks` must not.
  const photoId = uuid();
  await db.insert(artworkPhotosTable).values({
    id: photoId,
    artworkId: blueNudeId,
    order: 0,
    name: "blue-nude.jpg",
  });
  // The serializer reads a photo through its `original` variant; a photo row
  // without one is a half-written save, never a fixture.
  await db.insert(artworkPhotoVariantsTable).values({
    parentKind: "photo",
    parentId: photoId,
    key: "original",
    width: 1200,
    height: 900,
    size: 123456,
    contentType: "image/jpeg",
  });
  await db.insert(artworkDocumentsTable).values({
    id: uuid(),
    artworkId: blueNudeId,
    kind: "file",
    name: "provenance.pdf",
    size: 4321,
    contentType: "application/pdf",
  });
});

afterAll(async () => {
  await closeDb();
});

describe("get_catalogue", () => {
  it("counts a member's works by status, deleted excluded", async () => {
    const answer = await getCatalogue(owner.userId, studioId);
    expect(answer).toMatchObject({
      id: studioId,
      name: "Studio Inventory",
      kind: "inventory",
      visibility: "public",
      description: "Works kept in the studio",
      passwordProtected: false,
      role: "owner",
    });
    expect(answer.counts).toEqual({ published: 2, draft: 1 });
  });

  it("answers a zero for a status the Catalogue does not hold", async () => {
    const emptyId = await makeCatalogue(owner.userId, { name: "Empty" });
    const answer = await getCatalogue(owner.userId, emptyId);
    expect(answer.counts).toEqual({ published: 0, draft: 0 });
  });

  it("names a collaborator's role", async () => {
    const answer = await getCatalogue(collaborator.userId, studioId);
    expect(answer.role).toBe("collaborator");
  });

  it("answers a member their private Catalogue's visibility", async () => {
    const answer = await getCatalogue(owner.userId, privateId);
    expect(answer).toMatchObject({ visibility: "private", role: "owner" });
  });

  it("counts a visitor's published works only — no draft key", async () => {
    const answer = await getCatalogue(stranger.userId, studioId);
    expect(answer.description).toBe("Works kept in the studio");
    expect(answer.counts).toEqual({ published: 2 });
    // The password state is the member's fact; a visitor is not told it.
    expect(answer.passwordProtected).toBeUndefined();
    expect(answer.role).toBeUndefined();
  });

  it("refuses a non-member of a private Catalogue in the app's words", async () => {
    await expect(
      getCatalogue(stranger.userId, privateId),
    ).rejects.toMatchObject({
      code: "forbidden",
      message: "This catalogue is private",
    });
  });

  it("answers not-found for a missing or deleted Catalogue", async () => {
    await expect(
      getCatalogue(owner.userId, "no-such-catalogue"),
    ).rejects.toMatchObject({
      code: "not-found",
      message: "The catalogue does not exist",
    });
    await expect(getCatalogue(owner.userId, deletedId)).rejects.toMatchObject({
      code: "not-found",
    });
  });
});

interface WorkSummary {
  id: string;
  title: string;
  artistName: string;
  status: string;
  availability?: string | null;
  medium?: string;
  dateOfCreation?: string;
  updatedAt: string;
}

interface SearchAnswer {
  total: number;
  limit: number | null;
  offset: number;
  artworks: WorkSummary[];
  facets?: Record<string, { value: string; count: number }[]>;
}

const searchArtworks = async (
  userId: string,
  args: Record<string, unknown>,
): Promise<SearchAnswer> =>
  (await dispatchTool({
    userId,
    name: "search_artworks",
    args,
  })) as SearchAnswer;

describe("search_artworks", () => {
  it("answers a page with the match count taken before paging", async () => {
    const answer = await searchArtworks(owner.userId, {
      catalogueId: studioId,
      sort: "title",
      limit: 2,
    });
    // Three live works: the draft is the member's, the deleted one is not.
    expect(answer).toMatchObject({ total: 3, limit: 2, offset: 0 });
    expect(answer.artworks.map((work) => work.id)).toEqual([
      blueNudeId,
      guitarId,
    ]);
  });

  it("defaults the limit to 50, so an offset stands alone", async () => {
    const answer = await searchArtworks(owner.userId, {
      catalogueId: studioId,
      sort: "title",
      offset: 1,
    });
    expect(answer).toMatchObject({ total: 3, limit: 50, offset: 1 });
    expect(answer.artworks.map((work) => work.title)).toEqual([
      "Guitar",
      "Sketch for Blue Nude",
    ]);
  });

  it("answers a summary with no media on it", async () => {
    const answer = await searchArtworks(owner.userId, {
      catalogueId: studioId,
      sort: "title",
      limit: 1,
    });
    expect(Object.keys(answer.artworks[0] ?? {}).sort()).toEqual([
      "artistName",
      "availability",
      "dateOfCreation",
      "id",
      "medium",
      "status",
      "title",
      "updatedAt",
    ]);
  });

  it("ORs the values within a field and ANDs different fields", async () => {
    // Either artist, and a Charcoal medium: only the draft qualifies. The
    // matching artist is the second value, so a first-value-only mapping
    // would answer nothing.
    const eitherArtist = await searchArtworks(owner.userId, {
      catalogueId: studioId,
      filters: {
        artistName: ["Pablo Picasso", "Henri Matisse"],
        medium: ["Charcoal"],
      },
    });
    expect(eitherArtist.artworks.map((work) => work.title)).toEqual([
      "Sketch for Blue Nude",
    ]);

    // One artist, oil: only her oil, so an across-field OR would answer both.
    const bothFields = await searchArtworks(owner.userId, {
      catalogueId: studioId,
      filters: {
        artistName: ["Henri Matisse"],
        medium: ["Oil on canvas"],
      },
    });
    expect(bothFields.total).toBe(1);
    expect(bothFields.artworks.map((work) => work.title)).toEqual([
      "Blue Nude",
    ]);
  });

  it("counts the facets over the filtered set, not the page", async () => {
    const answer = await searchArtworks(owner.userId, {
      catalogueId: studioId,
      filters: { medium: ["Oil on canvas"] },
      facets: ["artistName"],
      limit: 1,
    });
    expect(answer.total).toBe(2);
    // One work each, so count desc then value: both are 1 and the value
    // breaks the tie, normalized.
    expect(answer.facets?.artistName).toEqual([
      { value: "henri matisse", count: 1 },
      { value: "pablo picasso", count: 1 },
    ]);
  });

  it("answers a visitor published summaries only, with no availability", async () => {
    const answer = await searchArtworks(stranger.userId, {
      catalogueId: studioId,
      sort: "title",
    });
    expect(answer.total).toBe(2);
    expect(answer.artworks.map((work) => work.title)).toEqual([
      "Blue Nude",
      "Guitar",
    ]);
    // The market fact is the member's; a visitor's document omits the key.
    expect(answer.artworks[0]).not.toHaveProperty("availability");
  });

  it("refuses a filter the shared parser cannot answer", async () => {
    const refusal = await searchArtworks(owner.userId, {
      catalogueId: studioId,
      filters: { status: ["archived"] },
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ApiError);
    const { code, details } = refusal as ApiError;
    expect(code).toBe("validation");
    // The field that carries the problem is named, so the agent can fix it.
    expect((details?.fields as Record<string, string>).status).toContain(
      "archived",
    );
  });

  it("refuses a non-member of a private Catalogue in the app's words", async () => {
    await expect(
      searchArtworks(stranger.userId, { catalogueId: privateId }),
    ).rejects.toMatchObject({
      code: "forbidden",
      message: "You do not have access to this catalogue",
    });
  });
});

const getArtwork = async (
  userId: string,
  catalogueId: string,
  artworkId: string,
): Promise<ArtworkRead> =>
  (await dispatchTool({
    userId,
    name: "get_artwork",
    args: { catalogueId, artworkId },
  })) as ArtworkRead;

describe("get_artwork", () => {
  it("answers a member the full record, photos and documents included", async () => {
    const answer = await getArtwork(owner.userId, studioId, blueNudeId);
    expect(answer).toMatchObject({
      id: blueNudeId,
      title: "Blue Nude",
      artistName: "Henri Matisse",
      status: "published",
      availability: "sold",
      medium: "Oil on canvas",
      dateOfCreation: "1907",
    });
    expect(answer.photos.map((photo) => photo.name)).toEqual(["blue-nude.jpg"]);
    expect(answer.documents.map((document) => document.name)).toEqual([
      "provenance.pdf",
    ]);
  });

  it("answers a member a draft, with the absence of a market state as null", async () => {
    const answer = await getArtwork(owner.userId, studioId, sketchId);
    expect(answer).toMatchObject({
      title: "Sketch for Blue Nude",
      status: "draft",
    });
    expect(answer.availability).toBeNull();
  });

  it("answers a visitor a published work, without the market state", async () => {
    const answer = await getArtwork(stranger.userId, studioId, blueNudeId);
    expect(answer.title).toBe("Blue Nude");
    expect(answer).not.toHaveProperty("availability");
  });

  it("answers not-found for a deleted work, even to a member who may list it", async () => {
    // The app's Deleted view is a member read of a deleted row; an agent's
    // answer never carries one (user story #35). The same member still reads a
    // live work, so the refusal is the deletion stamp and not the membership.
    await expect(
      getArtwork(collaborator.userId, studioId, lostWorkId),
    ).rejects.toMatchObject({
      code: "not-found",
      message: "The artwork does not exist",
    });
    const live = await getArtwork(collaborator.userId, studioId, guitarId);
    expect(live.title).toBe("Guitar");
  });

  it("refuses a draft to a non-member as the app does", async () => {
    await expect(
      getArtwork(stranger.userId, studioId, sketchId),
    ).rejects.toMatchObject({
      code: "not-found",
      message: "The artwork does not exist",
    });
  });

  it("omits every record field the Catalogue has switched off", async () => {
    // The row keeps the values it had before the member changed their mind;
    // the agent's answer must follow the settings, as the forms do. A field
    // that is off is absent, not null, so a reader cannot mistake it for a
    // cleared value.
    const catalogueId = await makeCatalogue(owner.userId, {
      name: "Fields Off",
      kind: "collection",
      isPublic: true,
    });
    const artworkId = await insertWork(catalogueId, owner.userId, {
      title: "Hidden Fields",
      artistName: "Roxana Alvarado",
      serie: "Espacios",
      medium: "Acrylic on wood",
      dateOfCreation: "2021",
    });
    await db
      .update(cataloguesTable)
      .set({
        artworkFields: {
          serie: false,
          medium: false,
          dateOfCreation: false,
        },
      })
      .where(eq(cataloguesTable.id, catalogueId));

    const record = await getArtwork(owner.userId, catalogueId, artworkId);
    expect(record).toMatchObject({
      id: artworkId,
      title: "Hidden Fields",
      artistName: "Roxana Alvarado",
      status: "published",
    });
    expect(record).not.toHaveProperty("serie");
    expect(record).not.toHaveProperty("medium");
    expect(record).not.toHaveProperty("dateOfCreation");
    expect(record).not.toHaveProperty("availability");

    const page = (await dispatchTool({
      userId: owner.userId,
      name: "search_artworks",
      args: { catalogueId },
    })) as {
      artworks: Record<string, unknown>[];
    };
    expect(page.artworks[0]).toMatchObject({
      id: artworkId,
      title: "Hidden Fields",
      artistName: "Roxana Alvarado",
      status: "published",
    });
    expect(page.artworks[0]).not.toHaveProperty("medium");
    expect(page.artworks[0]).not.toHaveProperty("dateOfCreation");
    expect(page.artworks[0]).not.toHaveProperty("availability");

    // Hidden, not cleared: the stored row still holds what the member once
    // recorded, so switching the field back on brings it back.
    const [row] = await db
      .select({ serie: artworksTable.serie })
      .from(artworksTable)
      .where(eq(artworksTable.id, artworkId));
    expect(row?.serie).toBe("Espacios");
  });

  it("answers not-found for a missing work or one in another Catalogue", async () => {
    await expect(
      getArtwork(owner.userId, studioId, "no-such-artwork"),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(
      getArtwork(owner.userId, privateId, blueNudeId),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});
