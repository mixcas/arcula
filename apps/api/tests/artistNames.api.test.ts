// Artist Name suggestions over HTTP against the real stack: the caller's
// vocabulary, who contributes to it, how exact spellings collapse, and the two
// wire answers the read has (401, and an empty 200).
//
// The pure suite (artistNames.test.ts) owns the exhaustive collapse, order and
// truncation permutations. This suite pins their effect at the wire — the
// spec's Testing Decisions ask for the case/accent collapse and by-use order to
// be visible through the real app — and the scope only the wire can show: which
// collections the aggregate reads, which works inside them count, and that one
// caller's list is never another's.

import {
  artworks as artworksTable,
  collectionCollaborators as collaboratorsTable,
  collections as collectionsTable,
} from "@arcula/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db";
import { err, freshUser, json, req, uuid } from "./helpers/api";

type Account = { cookies: string; userId: string };

let owner: Account;
let collaborator: Account;
let outsider: Account;
let emptyCaller: Account;

/** The owner's collection, shared with the collaborator. */
let sharedCollectionId = "";
/** The collaborator's own collection: invisible to the owner. */
let collaboratorCollectionId = "";
/** A stranger's collection: nobody here may read its names. */
let foreignCollectionId = "";

interface WorkValues {
  artistName: string;
  status?: "draft" | "published";
  deleted?: boolean;
  updatedAt: Date;
}

async function insertWork(
  collectionId: string,
  userId: string,
  values: WorkValues,
): Promise<void> {
  await db.insert(artworksTable).values({
    id: uuid(),
    userId,
    collectionId,
    title: values.artistName === "" ? "Untitled" : values.artistName,
    artistName: values.artistName,
    status: values.status ?? "published",
    deletedAt: values.deleted ? new Date("2026-02-01T00:00:00.000Z") : null,
    createdAt: values.updatedAt,
    updatedAt: values.updatedAt,
  });
}

const namesPath = "/api/v1/artist-names";

/** The names a caller is offered. */
async function namesFor(cookies: string): Promise<string[]> {
  const res = await req("GET", namesPath, { cookies });
  expect(res.status).toBe(200);
  return await json<string[]>(res);
}

beforeAll(async () => {
  owner = await freshUser("NameOwner");
  collaborator = await freshUser("NameMate");
  outsider = await freshUser("NameOther");
  emptyCaller = await freshUser("NameEmpty");

  const now = new Date();
  sharedCollectionId = uuid();
  await db.insert(collectionsTable).values({
    id: sharedCollectionId,
    userId: owner.userId,
    mediaNamespaceId: uuid(),
    name: "The Shared Studio",
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(collaboratorsTable).values({
    collectionId: sharedCollectionId,
    userId: collaborator.userId,
  });

  // Four works under one artist in two spellings: the draft counts, and the
  // majority spelling wins the collapse.
  await insertWork(sharedCollectionId, owner.userId, {
    artistName: "Pablo Picasso",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  await insertWork(sharedCollectionId, owner.userId, {
    artistName: "Pablo Picasso",
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  });
  await insertWork(sharedCollectionId, owner.userId, {
    artistName: "Pablo Picasso",
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  });
  await insertWork(sharedCollectionId, owner.userId, {
    artistName: "pablo picasso",
    status: "draft",
    updatedAt: new Date("2026-01-04T00:00:00.000Z"),
  });

  // Accents collapse too, and the two spellings are one option.
  await insertWork(sharedCollectionId, owner.userId, {
    artistName: "María López",
    updatedAt: new Date("2026-01-05T00:00:00.000Z"),
  });
  await insertWork(sharedCollectionId, owner.userId, {
    artistName: "María López",
    updatedAt: new Date("2026-01-06T00:00:00.000Z"),
  });
  await insertWork(sharedCollectionId, owner.userId, {
    artistName: "Maria Lopez",
    updatedAt: new Date("2026-01-07T00:00:00.000Z"),
  });

  // The count-one tail, including the case-insensitive name order: "alice"
  // belongs before "Bob" although the plain byte order would say otherwise.
  await insertWork(sharedCollectionId, owner.userId, {
    artistName: "Claude Monet",
    updatedAt: new Date("2026-01-07T00:00:00.000Z"),
  });
  await insertWork(sharedCollectionId, owner.userId, {
    artistName: "Draft Discovery",
    status: "draft",
    updatedAt: new Date("2026-01-08T00:00:00.000Z"),
  });
  await insertWork(sharedCollectionId, owner.userId, {
    artistName: "alice",
    updatedAt: new Date("2026-01-09T00:00:00.000Z"),
  });
  await insertWork(sharedCollectionId, owner.userId, {
    artistName: "Bob",
    updatedAt: new Date("2026-01-10T00:00:00.000Z"),
  });

  // Neither the deleted work nor the blank spellings may reach the list.
  await insertWork(sharedCollectionId, owner.userId, {
    artistName: "Deleted Artist",
    deleted: true,
    updatedAt: new Date("2026-01-11T00:00:00.000Z"),
  });
  await insertWork(sharedCollectionId, owner.userId, {
    artistName: "",
    updatedAt: new Date("2026-01-12T00:00:00.000Z"),
  });
  await insertWork(sharedCollectionId, owner.userId, {
    artistName: "   ",
    updatedAt: new Date("2026-01-13T00:00:00.000Z"),
  });

  // A deleted collection keeps its rows, and keeps contributing nothing.
  const deletedCollectionId = uuid();
  await db.insert(collectionsTable).values({
    id: deletedCollectionId,
    userId: owner.userId,
    mediaNamespaceId: uuid(),
    name: "The Stamped Studio",
    isPublic: true,
    deletedAt: new Date("2026-02-02T00:00:00.000Z"),
    createdAt: now,
    updatedAt: now,
  });
  await insertWork(deletedCollectionId, owner.userId, {
    artistName: "Ghost Artist",
    updatedAt: new Date("2026-01-14T00:00:00.000Z"),
  });

  collaboratorCollectionId = uuid();
  await db.insert(collectionsTable).values({
    id: collaboratorCollectionId,
    userId: collaborator.userId,
    mediaNamespaceId: uuid(),
    name: "The Collaborator's Own",
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  });
  await insertWork(collaboratorCollectionId, collaborator.userId, {
    artistName: "Vincent van Gogh",
    updatedAt: new Date("2026-01-15T00:00:00.000Z"),
  });

  foreignCollectionId = uuid();
  await db.insert(collectionsTable).values({
    id: foreignCollectionId,
    userId: outsider.userId,
    mediaNamespaceId: uuid(),
    name: "Someone Else's Studio",
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  });
  await insertWork(foreignCollectionId, outsider.userId, {
    artistName: "Secret Artist",
    updatedAt: new Date("2026-01-16T00:00:00.000Z"),
  });
});

afterAll(async () => {
  await closeDb();
});

/** The names the owner's own collection contributes, in the list's order. */
const OWNER_NAMES = [
  "Pablo Picasso",
  "María López",
  "alice",
  "Bob",
  "Claude Monet",
  "Draft Discovery",
];

describe("the caller's vocabulary", () => {
  it("gives an owner the names in their own collection, drafts included", async () => {
    expect(await namesFor(owner.cookies)).toEqual(OWNER_NAMES);
  });

  it("gives a collaborator the shared collection's names plus their own", async () => {
    expect(await namesFor(collaborator.cookies)).toEqual([
      ...OWNER_NAMES,
      "Vincent van Gogh",
    ]);
  });

  it("never crosses into a collection the caller cannot read", async () => {
    // The outsider's own list is the only name they may see; the owner's and
    // the collaborator's collections are closed books.
    expect(await namesFor(outsider.cookies)).toEqual(["Secret Artist"]);
  });
});

describe("the wire", () => {
  it("answers 401 without a session", async () => {
    const res = await req("GET", namesPath);
    expect(res.status).toBe(401);
    expect((await err(res)).code).toBe("unauthorized");
  });

  it("answers an empty 200 for a caller with no collections", async () => {
    expect(await namesFor(emptyCaller.cookies)).toEqual([]);
  });
});
