// The public Selection address: publish, read, unlock, and the two ways the
// address dies.
//
// This suite is the ticket's acceptance criteria over the real app and the real
// stack:
//
//   - Public works for a visitor; Private and deleted answer not-found.
//   - A public Selection cut from a Private Catalogue is readable.
//   - Protected challenges, throttles repeated failures and unlocks for twelve
//     hours; changing or clearing the password ends existing grants.
//   - Deleting the source Catalogue kills every Selection address without
//     stamping a single Selection row.
//
// The wire shape is asserted here too, because it is a promise: the source
// Catalogue's name travels, and its id, address and password state do not.

import { eq, inArray } from "drizzle-orm";
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
  selections as selectionsTable,
  selectionAccessGrants as selectionGrantsTable,
} from "@arcula/db";
import type { Selection, SelectionPublicRead } from "@arcula/shared";
import { CLIENT_ADDRESS_HEADER } from "../src/clientAddress";
import { closeDb, db } from "../src/db";
import { err, freshUser, json, req, sessionCookies } from "./helpers/api";
import { makeCatalogue } from "./helpers/fixtures";

type Account = { email: string; cookies: string; userId: string };

let owner: Account;
let stranger: Account;

/** A private Catalogue: the interesting parent for a public Selection. */
let privateCid = "";
const PRIVATE_CATALOGUE_NAME = "Private Wall";

const selectionsPath = (catalogueId: string) =>
  `/api/v1/catalogues/${catalogueId}/selections`;

const selectionPath = (catalogueId: string, selectionId: string) =>
  `${selectionsPath(catalogueId)}/${selectionId}`;

const publicPath = (selectionId: string) => `/api/v1/selections/${selectionId}`;

async function createSelection(
  catalogueId: string,
  name: string,
  description?: string,
  account: Account = owner,
): Promise<Selection> {
  const res = await req("POST", selectionsPath(catalogueId), {
    cookies: account.cookies,
    body: { name, description },
  });
  expect(res.status).toBe(201);
  return await json<Selection>(res);
}

async function patchSelection(
  catalogueId: string,
  selectionId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return req("PATCH", selectionPath(catalogueId, selectionId), {
    cookies: owner.cookies,
    body,
  });
}

async function readPublic(selectionId: string, cookies?: string) {
  return req("GET", publicPath(selectionId), { cookies });
}

const unlock = (
  selectionId: string,
  password: string,
  address?: string,
  cookies?: string,
) =>
  req("POST", `${publicPath(selectionId)}/unlock`, {
    cookies,
    body: { password },
    headers: address ? { [CLIENT_ADDRESS_HEADER]: address } : undefined,
  });

/** The grant cookie a successful unlock set, as a Cookie header. */
const grantCookies = (res: Response): string => sessionCookies(res);

beforeAll(async () => {
  owner = await freshUser("PublicSelectionOwner");
  stranger = await freshUser("PublicSelectionOther");
  privateCid = await makeCatalogue(owner.userId, {
    isPublic: false,
    name: PRIVATE_CATALOGUE_NAME,
  });
});

afterAll(closeDb);

describe("GET /selections/{sid} — who may read the address", () => {
  it("publishes a Selection and reads it as a visitor, carrying the Catalogue's name only", async () => {
    const selection = await createSelection(
      privateCid,
      "Fair 2026",
      "Twelve works for the fair.",
    );
    const published = await patchSelection(privateCid, selection.id, {
      isPublic: true,
    });
    expect(published.status).toBe(200);

    const res = await readPublic(selection.id);
    expect(res.status).toBe(200);
    const body = await json<SelectionPublicRead & Record<string, unknown>>(res);

    expect(body).toEqual({
      selection: {
        id: selection.id,
        name: "Fair 2026",
        description: "Twelve works for the fair.",
        isPublic: true,
      },
      catalogueName: PRIVATE_CATALOGUE_NAME,
      kind: "collection",
    });
    // The source Catalogue's id, address and password state are not on the
    // wire: its page is a different gate, often a private one.
    expect(JSON.stringify(body)).not.toContain(privateCid);
    expect(body).not.toHaveProperty("catalogueId");
    expect(body.selection).not.toHaveProperty("catalogueId");
    expect(body.selection).not.toHaveProperty("isPasswordProtected");
  });

  it("carries the source Catalogue's skin and raw options, for the web to resolve", async () => {
    const cid = await makeCatalogue(owner.userId, {
      isPublic: false,
      name: "Skin Source",
    });
    await req("PATCH", `/api/v1/catalogues/${cid}`, {
      cookies: owner.cookies,
      body: {
        skin: "basicx",
        skinOptions: { transitionSeconds: 0.75 },
      },
    });
    const selection = await createSelection(cid, "Skin Trial");
    await patchSelection(cid, selection.id, { isPublic: true });

    const body = await json<SelectionPublicRead>(
      await readPublic(selection.id),
    );
    expect(body.skin).toBe("basicx");
    expect(body.skinOptions).toEqual({ transitionSeconds: 0.75 });
  });

  it("carries the source Catalogue's Kind and field choices, never its address", async () => {
    // The same presentation facts a Catalogue's own public read carries: the
    // visitor's PDF must print the field set a member's does.
    const cid = await makeCatalogue(owner.userId, {
      isPublic: false,
      name: "Field Source",
      kind: "portfolio",
      artworkFields: { medium: false, editions: false },
    });
    const selection = await createSelection(cid, "Field Trial");
    await patchSelection(cid, selection.id, { isPublic: true });

    const body = await json<SelectionPublicRead>(
      await readPublic(selection.id),
    );
    expect(body.kind).toBe("portfolio");
    expect(body.artworkFields).toEqual({ medium: false, editions: false });
    expect(JSON.stringify(body)).not.toContain(cid);
  });

  it("answers not-found for a private Selection, and for a deleted one", async () => {
    const secret = await createSelection(privateCid, "Still Private");
    expect((await readPublic(secret.id)).status).toBe(404);

    const deleted = await createSelection(privateCid, "Soon Deleted");
    await patchSelection(privateCid, deleted.id, { isPublic: true });
    const removal = await req("DELETE", selectionPath(privateCid, deleted.id), {
      cookies: owner.cookies,
    });
    expect(removal.status).toBe(204);
    expect((await readPublic(deleted.id)).status).toBe(404);
  });

  it("lets a member preview their own private Selection at the address", async () => {
    // The API decides, not the page: an owner checking a link before sharing it
    // is legitimate, and the read returns the document instead of the visitor's
    // not-found.
    const preview = await createSelection(privateCid, "Preview Me");
    const res = await readPublic(preview.id, owner.cookies);
    expect(res.status).toBe(200);
    expect((await json<SelectionPublicRead>(res)).selection.isPublic).toBe(
      false,
    );
  });

  it("reads a public Selection cut from a private Catalogue", async () => {
    // The decision, restated as a route: the Catalogue's visibility never
    // enters the Selection's verdict.
    const selection = await createSelection(privateCid, "Private Parent");
    await patchSelection(privateCid, selection.id, { isPublic: true });
    expect((await readPublic(selection.id)).status).toBe(200);
  });

  it("answers not-found for a Selection that never existed", async () => {
    expect((await readPublic("doesnotexist1234567890")).status).toBe(404);
  });
});

describe("POST /selections/{sid}/unlock — the Selection's own gate", () => {
  const PASSWORD = "open-sesame";

  async function protectedSelection(name: string): Promise<Selection> {
    const selection = await createSelection(privateCid, name);
    const res = await patchSelection(privateCid, selection.id, {
      isPublic: true,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    return selection;
  }

  it("challenges without a grant, naming the Selection", async () => {
    const selection = await protectedSelection("Protected Fair");
    const res = await readPublic(selection.id);
    expect(res.status).toBe(403);
    const body = await err(res);
    expect(body.code).toBe("password-required");
    expect(body.details).toEqual({ selectionName: "Protected Fair" });
  });

  it("answers invalid-password for a wrong guess and admits the right one for twelve hours", async () => {
    const selection = await protectedSelection("Unlock Me");
    const wrong = await unlock(selection.id, "not-the-password");
    expect(wrong.status).toBe(403);
    expect((await err(wrong)).code).toBe("invalid-password");

    const right = await unlock(selection.id, PASSWORD);
    expect(right.status).toBe(201);
    const [raw] = right.headers.getSetCookie();
    expect(raw).toMatch(new RegExp(`^arcula_selection_grant_${selection.id}=`));
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("Path=/api/v1");
    expect(raw).toContain("Max-Age=43200");
    expect(raw.toLowerCase()).toContain("samesite=lax");

    const read = await readPublic(selection.id, grantCookies(right));
    expect(read.status).toBe(200);
  });

  it("is not unlockable when it has no password, or is private", async () => {
    const open = await createSelection(privateCid, "Open Already");
    await patchSelection(privateCid, open.id, { isPublic: true });
    expect((await unlock(open.id, PASSWORD)).status).toBe(409);

    const privateWithPassword = await createSelection(
      privateCid,
      "Private With Password",
    );
    await patchSelection(privateCid, privateWithPassword.id, {
      password: PASSWORD,
    });
    expect((await unlock(privateWithPassword.id, PASSWORD)).status).toBe(409);
  });

  it("answers not-found for a deleted Selection", async () => {
    const selection = await protectedSelection("Deleted Lock");
    await req("DELETE", selectionPath(privateCid, selection.id), {
      cookies: owner.cookies,
    });
    expect((await unlock(selection.id, PASSWORD)).status).toBe(404);
  });

  it("ends every grant when the password changes", async () => {
    const selection = await protectedSelection("Rotate Me");
    const admitted = await unlock(selection.id, PASSWORD);
    const grant = grantCookies(admitted);
    expect((await readPublic(selection.id, grant)).status).toBe(200);

    const changed = await patchSelection(privateCid, selection.id, {
      password: "a-new-password",
    });
    expect(changed.status).toBe(200);

    // The old grant is dead: the read is a challenge again, not a document.
    expect((await readPublic(selection.id, grant)).status).toBe(403);

    // The new password is the one that works.
    expect((await unlock(selection.id, PASSWORD)).status).toBe(403);
    const reopened = await unlock(selection.id, "a-new-password");
    expect(reopened.status).toBe(201);
    expect(
      (await readPublic(selection.id, grantCookies(reopened))).status,
    ).toBe(200);
  });

  it("makes a Selection public-unprotected when the password is cleared", async () => {
    const selection = await protectedSelection("Clear Me");
    const admitted = await unlock(selection.id, PASSWORD);
    const grant = grantCookies(admitted);
    expect((await readPublic(selection.id, grant)).status).toBe(200);

    const cleared = await patchSelection(privateCid, selection.id, {
      password: null,
    });
    expect(cleared.status).toBe(200);

    // No grant is needed any more, and the old one is gone too.
    expect((await readPublic(selection.id)).status).toBe(200);
    expect((await readPublic(selection.id, grant)).status).toBe(200);
    expect((await unlock(selection.id, PASSWORD)).status).toBe(409);
  });

  it("deletes the Selection's grants on a password write", async () => {
    const selection = await protectedSelection("Grant Rows");
    const admitted = await unlock(selection.id, PASSWORD);
    const before = await db
      .select()
      .from(selectionGrantsTable)
      .where(eq(selectionGrantsTable.selectionId, selection.id));
    expect(before.length).toBe(1);

    await patchSelection(privateCid, selection.id, { password: "another-one" });
    const after = await db
      .select()
      .from(selectionGrantsTable)
      .where(eq(selectionGrantsTable.selectionId, selection.id));
    expect(after).toHaveLength(0);
    expect(grantCookies(admitted)).not.toBe("");
  });
});

describe("the unlock throttle", () => {
  const PASSWORD = "open-sesame";

  beforeEach(() => {
    // The window is floored from the attempt's own time, so a run that crossed a
    // boundary would spend two windows. Pinning the clock keeps one case one
    // window.
    vi.setSystemTime(new Date("2026-03-01T12:00:05.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function protectedSelection(name: string): Promise<Selection> {
    const selection = await createSelection(privateCid, name);
    await patchSelection(privateCid, selection.id, {
      isPublic: true,
      password: PASSWORD,
    });
    return selection;
  }

  async function spendWindow(
    address: string,
    selection: Selection,
  ): Promise<void> {
    for (let failure = 1; failure <= 10; failure += 1) {
      const res = await unlock(selection.id, "not-the-password", address);
      expect(res.status, `failure ${failure} is still a password check`).toBe(
        403,
      );
    }
  }

  it("counts ten failures and refuses the eleventh, even with the right password", async () => {
    const address = "198.51.100.50";
    const selection = await protectedSelection("Throttled");
    await spendWindow(address, selection);

    const refused = await unlock(selection.id, PASSWORD, address);
    expect(refused.status).toBe(429);
    const body = await err(refused);
    expect(body.code).toBe("too-many-attempts");
    expect(body.details.windowMinutes).toBe(10);
    expect(refused.headers.getSetCookie()).toEqual([]);
  });

  it("keys the window by address and Selection, so neither throttles the other", async () => {
    const address = "198.51.100.51";
    const throttled = await protectedSelection("Throttled One");
    const other = await protectedSelection("Untouched Other");
    await spendWindow(address, throttled);

    // The same address against a second Selection is still answered: one
    // Selection's failures are not every Selection's lock.
    expect((await unlock(other.id, PASSWORD, address)).status).toBe(201);
    // And a different address against the spent Selection still is.
    expect((await unlock(throttled.id, PASSWORD, "198.51.100.52")).status).toBe(
      201,
    );
  });
});

describe("deleting the source Catalogue", () => {
  it("kills every Selection address without stamping a single Selection row", async () => {
    const cid = await makeCatalogue(owner.userId, {
      isPublic: false,
      name: "Doomed Parent",
    });
    const first = await createSelection(cid, "First Address");
    const second = await createSelection(cid, "Second Address");
    await patchSelection(cid, first.id, { isPublic: true });
    await patchSelection(cid, second.id, { isPublic: true });
    expect((await readPublic(first.id)).status).toBe(200);

    const removal = await req("DELETE", `/api/v1/catalogues/${cid}`, {
      cookies: owner.cookies,
    });
    expect(removal.status).toBe(204);

    expect((await readPublic(first.id)).status).toBe(404);
    expect((await readPublic(second.id)).status).toBe(404);
    // The member route answers the same not-found, and the rows are untouched:
    // an operator's restore of the Catalogue brings the addresses back.
    expect(
      (
        await req("GET", selectionPath(cid, first.id), {
          cookies: owner.cookies,
        })
      ).status,
    ).toBe(404);

    const rows = await db
      .select()
      .from(selectionsTable)
      .where(inArray(selectionsTable.id, [first.id, second.id]));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.deletedAt).toBeNull();
    }
  });
});

describe("a stranger", () => {
  it("still reads a public Selection, and never a private one", async () => {
    const publicSelection = await createSelection(privateCid, "Public To All");
    await patchSelection(privateCid, publicSelection.id, { isPublic: true });
    expect(
      (await readPublic(publicSelection.id, stranger.cookies)).status,
    ).toBe(200);

    const privateSelection = await createSelection(
      privateCid,
      "Private To All",
    );
    expect(
      (await readPublic(privateSelection.id, stranger.cookies)).status,
    ).toBe(404);
  });
});
