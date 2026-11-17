// The `import_artworks` tool at the dispatcher seam: a verified user id and a
// batch of extracted rows in, `{ inserted, rejected }` out.
//
// What is asserted here is what the tool owns rather than the route: the batch
// lands in Drafts unless the caller says otherwise, the 200-row cap lives in
// the tool's own schema (the route has none), the payload's status wins over a
// row's, and an import spends the hourly allowance on top of the write.
// The CSV route's half is `catalogues.api.test.ts`'s; the per-row parsing is
// the same core both call, so it is covered once.

import { afterAll, describe, expect, it } from "vitest";
import { AGENT_IMPORT_CAPACITY } from "../src/agentLimiter";
import { closeDb } from "../src/db";
import { ApiError } from "../src/errors";
import { dispatchTool } from "../src/mcp/dispatcher";
import { freshUser, listedArtworks, req } from "./helpers/api";
import { makeCatalogue } from "./helpers/fixtures";

interface ImportOutcome {
  inserted: number;
  rejected: { row: number; errors: Record<string, string> }[];
}

interface SearchAnswer {
  total: number;
  artworks: { title: string; status: string; medium?: string }[];
}

const call = async (userId: string, args: unknown): Promise<ImportOutcome> =>
  (await dispatchTool({
    userId,
    name: "import_artworks",
    args,
  })) as ImportOutcome;

/** The member read, through the tool the agent actually uses. */
const search = async (
  userId: string,
  catalogueId: string,
): Promise<SearchAnswer> =>
  (await dispatchTool({
    userId,
    name: "search_artworks",
    args: { catalogueId, limit: 100 },
  })) as SearchAnswer;

/** The visitor read, at the route a browser reaches: published works only. */
const visitorList = async (catalogueId: string) =>
  listedArtworks(
    await req("GET", `/api/v1/catalogues/${catalogueId}/artworks`),
  );

afterAll(async () => {
  await closeDb();
});

describe("import_artworks", () => {
  it("lands a batch of extracted rows as Drafts by default", async () => {
    // A member's own public catalogue: readable by a visitor, who must still
    // not see the drafts.
    const member = await freshUser("ImportDraft");
    const catalogueId = await makeCatalogue(member.userId, {
      name: "Extracted Works",
      isPublic: true,
    });

    const outcome = await call(member.userId, {
      catalogueId,
      rows: [
        { title: "Landscape", artistName: "C. Cas", medium: "Oil" },
        // A row's own status is not obeyed either: the batch's default wins.
        { title: "Landscape Photo", artistName: "C. Cas", status: "published" },
      ],
    });
    expect(outcome).toEqual({ inserted: 2, rejected: [] });

    const memberRead = await search(member.userId, catalogueId);
    expect(
      Object.fromEntries(
        memberRead.artworks.map((work) => [work.title, work.status]),
      ),
    ).toEqual({ Landscape: "draft", "Landscape Photo": "draft" });
    expect(
      memberRead.artworks.find((work) => work.title === "Landscape")?.medium,
    ).toBe("Oil");

    // Never to a visitor: the same route shows a member's draft and hides it.
    expect(await visitorList(catalogueId)).toEqual([]);
  });

  it("reports each failing row by its posted position and lands the rest", async () => {
    const member = await freshUser("ImportMixed");
    const catalogueId = await makeCatalogue(member.userId, {
      name: "Mixed Batch",
      isPublic: true,
    });

    const outcome = await call(member.userId, {
      catalogueId,
      rows: [
        { title: "Kept One", artistName: "C. Cas" },
        { title: "No Artist" },
        {
          title: "Bad Date",
          artistName: "C. Cas",
          acquisitionDate: "not-a-date",
        },
        { title: "Kept Two", artistName: "C. Cas" },
      ],
    });

    // The indexes are into the POSTED array, and the failed fields are named
    // by the shared schema; the accepted rows are the ones around them.
    expect(outcome.inserted).toBe(2);
    expect(outcome.rejected.map((rejection) => rejection.row)).toEqual([1, 2]);
    expect(Object.keys(outcome.rejected[0].errors)).toEqual(["artistName"]);
    expect(Object.keys(outcome.rejected[1].errors)).toEqual([
      "acquisitionDate",
    ]);

    const memberRead = await search(member.userId, catalogueId);
    expect(memberRead.artworks.map((work) => work.title).sort()).toEqual([
      "Kept One",
      "Kept Two",
    ]);
  });

  it("refuses more than 200 rows naming the cap, and accepts exactly 200", async () => {
    const member = await freshUser("ImportCap");
    const catalogueId = await makeCatalogue(member.userId, {
      name: "Capped Batch",
      isPublic: true,
    });
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        title: `Work ${index}`,
        artistName: "C. Cas",
      }));

    // The cap is the tool's own schema, not the route's: the refusal is a
    // validation error that names 200 and writes nothing.
    const refusal = await call(member.userId, {
      catalogueId,
      rows: rows(201),
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ApiError);
    const error = refusal as ApiError;
    expect(error.code).toBe("validation");
    expect(String(error.details?.rows)).toContain("200");
    expect((await search(member.userId, catalogueId)).total).toBe(0);

    const atCap = await call(member.userId, {
      catalogueId,
      rows: rows(200),
    });
    expect(atCap).toEqual({ inserted: 200, rejected: [] });
    expect((await search(member.userId, catalogueId)).total).toBe(200);
  });

  it("the status the payload names wins over one a row carries", async () => {
    const member = await freshUser("ImportStatusWin");
    const catalogueId = await makeCatalogue(member.userId, {
      name: "Named Status",
      isPublic: true,
    });

    const outcome = await call(member.userId, {
      catalogueId,
      status: "published",
      rows: [
        { title: "Row Says Draft", artistName: "C. Cas", status: "draft" },
        { title: "Row Says Published", artistName: "C. Cas" },
      ],
    });
    expect(outcome).toEqual({ inserted: 2, rejected: [] });

    const memberRead = await search(member.userId, catalogueId);
    expect(
      Object.fromEntries(
        memberRead.artworks.map((work) => [work.title, work.status]),
      ),
    ).toEqual({
      "Row Says Draft": "published",
      "Row Says Published": "published",
    });
    // Published means a visitor reads them too.
    expect(
      (await visitorList(catalogueId)).map((work) => work.title).sort(),
    ).toEqual(["Row Says Draft", "Row Says Published"]);
  });

  it("spends the account's hourly import allowance and refuses the sixth", async () => {
    const member = await freshUser("ImportAllowance");
    const catalogueId = await makeCatalogue(member.userId, {
      name: "Spent Allowance",
      isPublic: true,
    });
    const batch = (index: number) => ({
      catalogueId,
      rows: [{ title: `Import ${index}`, artistName: "C. Cas" }],
    });

    for (let index = 0; index < AGENT_IMPORT_CAPACITY; index += 1) {
      await call(member.userId, batch(index));
    }

    // The sixth import in the hour is #291's own refusal, reused unchanged:
    // the agent relays it and retries after the window.
    const refusal = await call(member.userId, batch(99)).catch(
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(ApiError);
    expect((refusal as ApiError).code).toBe("rate-limited");

    // The five calls landed; the refused call wrote nothing.
    const memberRead = await search(member.userId, catalogueId);
    expect(memberRead.total).toBe(AGENT_IMPORT_CAPACITY);
    expect(memberRead.artworks.map((work) => work.title)).not.toContain(
      "Import 99",
    );
  });
});
