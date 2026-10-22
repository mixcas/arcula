// The visitor's half of collection passwords, end to end on the real stack:
// the unlock route, the Access grant cookie it sets, and the verdict every read
// and the media proxy ask.
//
// This is the one place the wire, the schema, the proxy and the cookie meet.
// The pieces are each tested on their own — access.test.ts for the verdict,
// collectionGrants.test.ts for the grant's algebra, publicCollectionState.test.ts
// for the lock screen's fold — and what is only visible here is whether they
// compose: a stranger is refused the row and the bytes alike without a grant,
// gets both with one, and loses them the moment the password changes.
//
// What is deliberately not asserted here: the shape of the Set-Cookie header
// beyond the ADR's own decisions (`HttpOnly`, `SameSite=Lax`, twelve hours).
// Reading it back out and sending it as a browser would is the honest test of
// the transport; the exact serialisation is Hono's job.

import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  collectionAccessGrants as grantsTable,
  collections as collectionsTable,
} from "@arcula/db";
import {
  GRANT_TTL_MS,
  grantCookieName,
  hashGrantToken,
  mintGrantToken,
} from "../src/collectionGrants";
import { CLIENT_ADDRESS_HEADER } from "../src/clientAddress";
import { closeDb, db } from "../src/db";
import { err, freshUser, json, req, uuid } from "./helpers/api";
import {
  makeCollection,
  makeJpeg,
  processEntry,
  stageEntry,
} from "./helpers/fixtures";

const PASSWORD = "open-sesame";
/** The collection the throttle cases spend their windows on. */
const THROTTLED_PASSWORD = "throttle-me";

let owner: { cookies: string; userId: string };
let stranger: { cookies: string; userId: string };
/** A second Protected collection: proof that a grant is scoped by name. */
let otherId = "";
/** A public collection nobody has protected: there is nothing to unlock. */
let openId = "";
/** A protected collection the throttle cases spend their windows on. */
let throttledId = "";
let cid = "";
/** The published work, with one photo and one document. */
let workId = "";
let photoUrl = "";
let documentUrl = "";
/** A draft work, so the grant's limit — the visitor rule — has a case. */
let draftId = "";
let draftPhotoUrl = "";

/** The grant cookie exactly as a browser would send it back. */
function grantCookie(res: Response, collectionId = cid): string {
  const raw = res.headers
    .getSetCookie()
    .find((header) => header.startsWith(`${grantCookieName(collectionId)}=`));
  expect(raw).toBeDefined();
  return raw!.split(";")[0];
}

const unlock = (collectionId: string, password: string) =>
  req("POST", `/api/v1/collections/${collectionId}/unlock`, {
    body: { password },
  });

/** A protected collection's password, written through the settings route. */
async function protect(collectionId: string, password: string) {
  const res = await req("PATCH", `/api/v1/collections/${collectionId}`, {
    cookies: owner.cookies,
    body: { name: "Protected Wall", isPublic: true, password },
  });
  expect(res.status).toBe(200);
}

/** Stage and process one file, the way the editor's uploader does. */
async function stage(
  population: "photos" | "documents",
  artworkId: string,
  entryId: string,
  file: File,
): Promise<{ entryId: string; name: string }> {
  const staged = await stageEntry(
    population,
    owner.cookies,
    cid,
    artworkId,
    entryId,
    file,
  );
  expect(staged.status).toBe(200);
  const processed = await processEntry(
    owner.cookies,
    cid,
    artworkId,
    population,
    JSON.stringify({ entryId }),
  );
  expect(processed.status).toBe(200);
  return { entryId, name: file.name };
}

async function stagePhoto(
  artworkId: string,
  entryId: string,
): Promise<{ entryId: string; name: string }> {
  return stage(
    "photos",
    artworkId,
    entryId,
    new File([await makeJpeg()], `${entryId}.jpg`, { type: "image/jpeg" }),
  );
}

async function createWork(
  artworkId: string,
  status: "published" | "draft",
  photos: { entryId: string; name: string }[],
  documents: { entryId: string; name: string }[] = [],
): Promise<void> {
  const res = await req("POST", `/api/v1/collections/${cid}/artworks`, {
    cookies: owner.cookies,
    body: {
      artworkId,
      title: "Protected Work",
      artistName: "C. Cas",
      status,
      photos,
      documents,
    },
  });
  expect(res.status).toBe(201);
}

/** The owner's own read of a work: where the media proxy paths come from. */
async function ownerRead(artworkId: string): Promise<Record<string, unknown>> {
  const res = await req(
    "GET",
    `/api/v1/collections/${cid}/artworks/${artworkId}`,
    { cookies: owner.cookies },
  );
  expect(res.status).toBe(200);
  return await json<Record<string, unknown>>(res);
}

const originalUrl = (wire: Record<string, unknown>): string =>
  (wire.photos as { original: { url: string } }[])[0].original.url;

beforeAll(async () => {
  owner = await freshUser("Gate");
  stranger = await freshUser("Gate");

  const created = await req("POST", "/api/v1/collections", {
    cookies: owner.cookies,
    body: { name: "Protected Wall" },
  });
  expect(created.status).toBe(201);
  cid = String((await json<Record<string, unknown>>(created)).id);
  await protect(cid, PASSWORD);

  workId = uuid();
  const photo = await stagePhoto(workId, `gate-photo-${workId}`);
  const document = await stage(
    "documents",
    workId,
    `gate-doc-${workId}`,
    new File([new TextEncoder().encode("%PDF-1.4 (test)")], "report.pdf", {
      type: "application/pdf",
    }),
  );
  await createWork(workId, "published", [photo], [document]);

  draftId = uuid();
  const draftPhoto = await stagePhoto(draftId, `gate-draft-${draftId}`);
  await createWork(draftId, "draft", [draftPhoto]);

  const published = await ownerRead(workId);
  photoUrl = originalUrl(published);
  documentUrl = (published.documents as { original: { url: string } }[])[0]
    .original.url;
  draftPhotoUrl = originalUrl(await ownerRead(draftId));

  // The two collections the isolation and "not unlockable" cases need. Both
  // written straight through drizzle: the tier cap gives each account one
  // collection, and the cap is not what this file is about.
  otherId = await makeCollection(owner.userId, {
    isPublic: true,
    name: "Other Protected",
  });
  await protect(otherId, "another-password");
  openId = await makeCollection(owner.userId, {
    isPublic: true,
    name: "Open Wall",
  });
  throttledId = await makeCollection(owner.userId, {
    isPublic: true,
    name: "Throttled Wall",
  });
  await protect(throttledId, THROTTLED_PASSWORD);
});

afterAll(async () => {
  await closeDb();
});

describe("a protected collection's visitor half", () => {
  it("keeps the collection out of the anonymous list", async () => {
    const list = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/collections"),
    );
    expect(list.some((row) => row.id === cid)).toBe(false);
    // The open one still lists: the filter is "not protected", not "not
    // public".
    expect(list.some((row) => row.id === openId)).toBe(true);
  });

  it("refuses the collection read without a grant, and names the collection", async () => {
    const res = await req("GET", `/api/v1/collections/${cid}`);
    expect(res.status).toBe(403);
    const body = await json<{ error: Record<string, unknown> }>(res);
    // A challenge, not a private collection's refusal: the lock screen has to
    // be able to say what it is unlocking (ADR-0005).
    expect(body.error.code).toBe("password-required");
    // Nested in `details`, which is where the client reads it: `errorResponse`
    // spreads a top-level detail flat, and the web client parses
    // `error.details`. A detail at the wrong depth is a name nobody shows.
    expect(body.error.details).toEqual({ collectionName: "Protected Wall" });
    // And still never the member's fact, nor the hash.
    expect("isPasswordProtected" in body.error).toBe(false);
    expect("passwordHash" in body.error).toBe(false);
  });

  it("answers a wrong password with its own code, and sets no grant", async () => {
    const res = await unlock(cid, "not-the-password");
    expect(res.status).toBe(403);
    expect((await err(res)).code).toBe("invalid-password");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("is not unlockable when there is no password to get past", async () => {
    const res = await unlock(openId, PASSWORD);
    expect(res.status).toBe(409);
    expect((await err(res)).code).toBe("conflict");
  });

  it("admits the reader with the right password, and the cookie it sets is the grant", async () => {
    const res = await unlock(cid, PASSWORD);
    expect(res.status).toBe(201);

    // The ADR's decisions, not Hono's serialisation: no script reads the
    // token, it rides the API's own path (the media proxy is one route for
    // every collection, so no narrower prefix covers it), and it lapses with
    // the row.
    const raw = res.headers.getSetCookie()[0];
    expect(raw).toContain(`${grantCookieName(cid)}=`);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toContain("Path=/api/v1");
    expect(raw).toContain(`Max-Age=${GRANT_TTL_MS / 1000}`);

    const cookie = grantCookie(res);

    const read = await req("GET", `/api/v1/collections/${cid}`, {
      cookies: cookie,
    });
    expect(read.status).toBe(200);
    const body = await json<Record<string, unknown>>(read);
    expect(body.name).toBe("Protected Wall");
    // Still a visitor's document: the password state is a member's.
    expect("isPasswordProtected" in body).toBe(false);

    const list = await req("GET", `/api/v1/collections/${cid}/artworks`, {
      cookies: cookie,
    });
    expect(list.status).toBe(200);
    // Exactly what a visitor sees: the published work, and no draft.
    expect((await json<{ id: string }[]>(list)).map((work) => work.id)).toEqual(
      [workId],
    );

    const single = await req(
      "GET",
      `/api/v1/collections/${cid}/artworks/${workId}`,
      { cookies: cookie },
    );
    expect(single.status).toBe(200);
  });

  it("covers the bytes: the photo needs the grant, the document never yields to it", async () => {
    const cookie = grantCookie(await unlock(cid, PASSWORD));

    expect((await req("GET", photoUrl)).status).toBe(404);
    expect(
      (await req("GET", photoUrl, { cookies: stranger.cookies })).status,
    ).toBe(404);
    const granted = await req("GET", photoUrl, { cookies: cookie });
    expect(granted.status).toBe(200);
    expect(granted.headers.get("Content-Type")).toBe("image/jpeg");
    // Admitted by the reader's grant, not by the URL: a shared cache must not
    // keep these bytes for the next person holding the link.
    expect(granted.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect((await granted.arrayBuffer()).byteLength).toBeGreaterThan(0);

    // A document is a member's at every status: the grant buys entry through
    // the collection's gate and nothing more.
    expect((await req("GET", documentUrl, { cookies: cookie })).status).toBe(
      403,
    );
    expect(
      (await req("GET", documentUrl, { cookies: owner.cookies })).status,
    ).toBe(200);
  });

  it("never admits a draft through a grant", async () => {
    const cookie = grantCookie(await unlock(cid, PASSWORD));
    const single = await req(
      "GET",
      `/api/v1/collections/${cid}/artworks/${draftId}`,
      { cookies: cookie },
    );
    expect(single.status).toBe(404);
    expect((await req("GET", draftPhotoUrl, { cookies: cookie })).status).toBe(
      404,
    );
  });

  it("never consults another collection's grant", async () => {
    const other = grantCookie(
      await unlock(otherId, "another-password"),
      otherId,
    );
    // Named for the other collection, so this one's routes never read it.
    const read = await req("GET", `/api/v1/collections/${cid}`, {
      cookies: other,
    });
    expect(read.status).toBe(403);
    expect((await err(read)).code).toBe("password-required");
    expect((await req("GET", photoUrl, { cookies: other })).status).toBe(404);
  });

  it("does not admit a token minted for another collection, even under this collection's name", async () => {
    // The name is the first line, the row's own collection the second: a
    // working grant for someone else's collection is not a way into this one,
    // whichever cookie name it arrives under.
    const token = mintGrantToken();
    const now = new Date();
    await db.insert(grantsTable).values({
      collectionId: otherId,
      tokenHash: hashGrantToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + GRANT_TTL_MS),
    });
    const cookie = `${grantCookieName(cid)}=${token}`;
    const read = await req("GET", `/api/v1/collections/${cid}`, {
      cookies: cookie,
    });
    expect(read.status).toBe(403);
    expect((await err(read)).code).toBe("password-required");
    expect((await req("GET", photoUrl, { cookies: cookie })).status).toBe(404);
  });

  it("locks the reader out again when the grant has expired", async () => {
    const token = mintGrantToken();
    const now = Date.now();
    await db.insert(grantsTable).values({
      collectionId: cid,
      tokenHash: hashGrantToken(token),
      createdAt: new Date(now - GRANT_TTL_MS),
      expiresAt: new Date(now - 1),
    });
    const read = await req("GET", `/api/v1/collections/${cid}`, {
      cookies: `${grantCookieName(cid)}=${token}`,
    });
    // The challenge again, not an error: the page goes back to the lock
    // screen rather than to "something went wrong".
    expect(read.status).toBe(403);
    expect((await err(read)).code).toBe("password-required");
  });

  it("revokes the outstanding grant when the password changes", async () => {
    const cookie = grantCookie(await unlock(cid, PASSWORD));
    expect(
      (await req("GET", `/api/v1/collections/${cid}`, { cookies: cookie }))
        .status,
    ).toBe(200);

    await protect(cid, "a-new-password");

    const after = await req("GET", `/api/v1/collections/${cid}`, {
      cookies: cookie,
    });
    expect(after.status).toBe(403);
    expect((await err(after)).code).toBe("password-required");
    expect((await req("GET", photoUrl, { cookies: cookie })).status).toBe(404);
    // The rows are gone, not merely refused.
    const rows = await db
      .select({ tokenHash: grantsTable.tokenHash })
      .from(grantsTable)
      .where(eq(grantsTable.collectionId, cid));
    expect(rows).toEqual([]);

    // The new password admits, and the old one no longer does.
    expect((await unlock(cid, PASSWORD)).status).toBe(403);
    expect((await unlock(cid, "a-new-password")).status).toBe(201);
  });

  it("leaves the collection table's password state the settings page reads", async () => {
    // The hash is the only thing that survives, and never the plaintext.
    const [row] = await db
      .select({ passwordHash: collectionsTable.passwordHash })
      .from(collectionsTable)
      .where(eq(collectionsTable.id, cid));
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain("a-new-password");
  });
});

// Guessing at a password, end to end: the counter the route writes, the 429 it
// answers past the window, and the two things that make the counter safe to
// live with — a right password clears the debt, and one collection's throttle
// never becomes another's weapon. Each case invents its own address, so the
// cases cannot spend each other's windows.
describe("the unlock throttle", () => {
  // The window is floored from the attempt's own time, so a sequence that
  // happened to cross a ten-minute boundary would spend two windows and leave
  // the eleventh attempt answered as a wrong password. Pinning the clock is
  // what keeps one case one window on every run.
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-03-01T12:00:05.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** One attempt from an address the gateway would have named. */
  const attempt = (address: string, collectionId: string, password: string) =>
    req("POST", `/api/v1/collections/${collectionId}/unlock`, {
      body: { password },
      headers: { [CLIENT_ADDRESS_HEADER]: address },
    });

  /** Spend a window: ten wrong passwords, which are ten failures. */
  async function spendWindow(address: string): Promise<void> {
    for (let failure = 1; failure <= 10; failure += 1) {
      const res = await attempt(address, throttledId, "not-the-password");
      expect(res.status, `failure ${failure} is still a password check`).toBe(
        403,
      );
    }
  }

  it("counts ten failures and refuses the eleventh, stating the window", async () => {
    const address = "198.51.100.10";
    await spendWindow(address);

    const refused = await attempt(address, throttledId, "not-the-password");
    expect(refused.status).toBe(429);
    const body = await err(refused);
    expect(body.code).toBe("too-many-attempts");
    // The window, not the countdown: a reader is told how long a window is,
    // and nobody is told how much of it is left.
    expect(body.details.windowMinutes).toBe(10);
    // Refused unread: no grant, however the guess would have gone.
    expect(refused.headers.getSetCookie()).toEqual([]);
  });

  it("refuses a right password once the window is spent", async () => {
    const address = "198.51.100.11";
    await spendWindow(address);

    const right = await attempt(address, throttledId, THROTTLED_PASSWORD);
    expect(right.status).toBe(429);
    expect((await err(right)).code).toBe("too-many-attempts");
    expect(right.headers.getSetCookie()).toEqual([]);
  });

  it("lets a right password through inside the limit, and clears the debt", async () => {
    const address = "198.51.100.12";
    for (let failure = 1; failure <= 9; failure += 1) {
      expect(
        (await attempt(address, throttledId, "not-the-password")).status,
      ).toBe(403);
    }

    const admitted = await attempt(address, throttledId, THROTTLED_PASSWORD);
    expect(admitted.status).toBe(201);
    expect(grantCookie(admitted, throttledId)).toBeTruthy();

    // The count went with it: ten *more* failures are all counted, where a
    // surviving count would have refused the second of them.
    for (let failure = 1; failure <= 10; failure += 1) {
      const res = await attempt(address, throttledId, "not-the-password");
      expect(res.status, `failure after a success: ${failure}`).toBe(403);
    }
    expect(
      (await attempt(address, throttledId, "not-the-password")).status,
    ).toBe(429);
  });

  it("keys the window by address and collection, so neither throttles the other", async () => {
    const spent = "198.51.100.13";
    await spendWindow(spent);
    expect((await attempt(spent, throttledId, THROTTLED_PASSWORD)).status).toBe(
      429,
    );

    // The same address against someone else's protected collection is still
    // answered — a shared address (a gallery's wifi, a proxy) is not a way to
    // close every lock in the product.
    expect((await attempt(spent, otherId, "another-password")).status).toBe(
      201,
    );
    // And a different address against the spent collection still is.
    expect(
      (await attempt("198.51.100.14", throttledId, THROTTLED_PASSWORD)).status,
    ).toBe(201);
  });
});
