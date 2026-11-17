// The Catalogue write tools at the dispatcher seam: a verified user id and an
// argument bag in, the Catalogue as written out.
//
// These are the rules the tools own rather than the route: the Kind is
// required at creation (the shared create schema defaults it, which an agent
// cannot see), it cannot change afterwards, and every write spends the
// account's allowance. The membership verdicts are the app's own — a
// collaborator writes, a non-member does not — and the tier cap is relayed,
// never retried.
//
// The route suite (`catalogues.api.test.ts`) owns the route's behaviour; these
// cases do not repeat it, and the shared core is covered once on each side.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogueCollaborators as collaboratorsTable } from "@arcula/db";
import { CATALOGUE_LIMITS, MINTED_ID_RE } from "@arcula/shared";
import { AGENT_WRITE_CAPACITY } from "../src/agentLimiter";
import { closeDb, db } from "../src/db";
import { ApiError } from "../src/errors";
import { dispatchTool } from "../src/mcp/dispatcher";
import { freshUser } from "./helpers/api";
import { makeCatalogue, seedCatalogues } from "./helpers/fixtures";

interface CatalogueAnswer {
  id: string;
  name: string;
  kind: string;
  description?: string;
  isPublic: boolean;
  userId: string;
}

const call = async (
  userId: string,
  name: string,
  args: unknown,
): Promise<unknown> => dispatchTool({ userId, name, args });

const create = async (
  userId: string,
  args: unknown,
): Promise<CatalogueAnswer> =>
  (await call(userId, "create_catalogue", args)) as CatalogueAnswer;

const update = async (
  userId: string,
  args: unknown,
): Promise<CatalogueAnswer> =>
  (await call(userId, "update_catalogue", args)) as CatalogueAnswer;

const listedCatalogueCount = async (userId: string): Promise<number> =>
  (
    (await call(userId, "list_catalogues", {})) as {
      total: number;
    }
  ).total;

let owner: { email: string; cookies: string; userId: string };
let collaborator: { email: string; cookies: string; userId: string };
let stranger: { email: string; cookies: string; userId: string };

beforeAll(async () => {
  owner = await freshUser("AgentOwner");
  collaborator = await freshUser("AgentCollaborator");
  stranger = await freshUser("AgentStranger");
});

afterAll(async () => {
  await closeDb();
});

describe("create_catalogue", () => {
  it("creates with the Kind the caller named and answers the new Catalogue", async () => {
    const answer = await create(owner.userId, {
      name: "Agent Portfolio",
      kind: "portfolio",
      description: "Paints at night",
      isPublic: false,
    });
    expect(answer).toMatchObject({
      name: "Agent Portfolio",
      kind: "portfolio",
      description: "Paints at night",
      isPublic: false,
      userId: owner.userId,
    });
    // The id the other tools take is the route's own minted shape.
    expect(answer.id).toMatch(MINTED_ID_RE);
  });

  it("refuses a missing Kind, naming the three values, and writes nothing", async () => {
    const capped = await freshUser("AgentKindless");
    const refusal = await call(capped.userId, "create_catalogue", {
      name: "No Kind",
    }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ApiError);
    const error = refusal as ApiError;
    expect(error.code).toBe("validation");
    // The agent's only fix is the right word; the refusal names all three.
    const kindField = error.details?.kind;
    expect(kindField).toEqual(expect.stringContaining("portfolio"));
    expect(kindField).toEqual(expect.stringContaining("collection"));
    expect(kindField).toEqual(expect.stringContaining("inventory"));
    // No default was applied and no row was written.
    expect(await listedCatalogueCount(capped.userId)).toBe(0);
  });
});

describe("update_catalogue", () => {
  it("writes name, description and visibility, and answers the Catalogue as written", async () => {
    const created = await create(owner.userId, {
      name: "Renamed Source",
      kind: "collection",
    });
    const written = await update(owner.userId, {
      catalogueId: created.id,
      name: "Renamed",
      description: "About the wall",
      isPublic: false,
    });
    expect(written).toMatchObject({
      id: created.id,
      name: "Renamed",
      description: "About the wall",
      isPublic: false,
    });
  });

  it("cannot change the Kind: a caller passing one changes only the fields it owns", async () => {
    const created = await create(owner.userId, {
      name: "KindFixed",
      kind: "inventory",
    });
    // `kind` is not in the tool's schema; the argument bag is stripped, not
    // obeyed. A test of the shape would pass without asking the row.
    const written = await update(owner.userId, {
      catalogueId: created.id,
      name: "KindStillFixed",
      kind: "portfolio",
    });
    expect(written.kind).toBe("inventory");
    expect(written.name).toBe("KindStillFixed");
  });

  it("lets a collaborator write the settings", async () => {
    const sharedId = await makeCatalogue(owner.userId, { name: "Shared" });
    await db
      .insert(collaboratorsTable)
      .values({ catalogueId: sharedId, userId: collaborator.userId });

    const written = await update(collaborator.userId, {
      catalogueId: sharedId,
      name: "Shared Renamed",
    });
    expect(written.name).toBe("Shared Renamed");
  });

  it("refuses an account with no membership", async () => {
    const privateId = await makeCatalogue(owner.userId, {
      name: "Members Only",
      isPublic: false,
    });
    await expect(
      update(stranger.userId, {
        catalogueId: privateId,
        name: "Hijacked",
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      message: "You do not have access to this catalogue",
    });
    // The refused write landed nowhere.
    const read = await call(owner.userId, "list_catalogues", {});
    const row = (
      read as { catalogues: { id: string; name: string }[] }
    ).catalogues.find((catalogue) => catalogue.id === privateId);
    expect(row?.name).toBe("Members Only");
  });
});

describe("the write allowance", () => {
  /** Spend the whole rolling window for an account, one write per call. */
  const spendAllowance = async (userId: string, catalogueId: string) => {
    for (let i = 0; i < AGENT_WRITE_CAPACITY; i += 1) {
      await update(userId, { catalogueId, name: `Write ${i}` });
    }
  };

  it("refuses the write past the allowance, naming it, and writes nothing", async () => {
    const busy = await freshUser("AgentBusy");
    const catalogueId = await makeCatalogue(busy.userId, { name: "Busy" });
    await spendAllowance(busy.userId, catalogueId);

    const refusal = await call(busy.userId, "update_catalogue", {
      catalogueId,
      name: "Refused",
    }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ApiError);
    // The spec's numbers, not the limiter's own: twenty writes in a rolling
    // twenty-second window, retryable once the window has passed.
    expect(refusal).toMatchObject({
      code: "rate-limited",
      status: 429,
      details: { allowance: 20, windowSeconds: 20 },
    });
    expect((refusal as ApiError).message).toContain("20 writes in 20 seconds");

    // The refused call landed nowhere — and the read that proves it is not
    // metered, so an exhausted account can still see what it has.
    const listed = (await call(busy.userId, "list_catalogues", {})) as {
      catalogues: { id: string; name: string }[];
    };
    expect(
      listed.catalogues.find((catalogue) => catalogue.id === catalogueId)?.name,
    ).toBe(`Write ${AGENT_WRITE_CAPACITY - 1}`);
  });

  it("meters creation too: an exhausted account cannot create below its cap", async () => {
    const busy = await freshUser("AgentBusyCreate");
    const catalogueId = await makeCatalogue(busy.userId, { name: "Busy" });
    await spendAllowance(busy.userId, catalogueId);

    await expect(
      create(busy.userId, { name: "Refused", kind: "collection" }),
    ).rejects.toMatchObject({ code: "rate-limited" });
    // Its one owned Catalogue is still the only row: creation is metered
    // before the tier cap is even asked.
    expect(await listedCatalogueCount(busy.userId)).toBe(1);
  });

  it("leaves a second account unaffected while the first is exhausted", async () => {
    const busy = await freshUser("AgentBusyTwo");
    const busyCatalogue = await makeCatalogue(busy.userId, { name: "Busy" });
    await spendAllowance(busy.userId, busyCatalogue);
    await expect(
      update(busy.userId, { catalogueId: busyCatalogue, name: "Refused" }),
    ).rejects.toMatchObject({ code: "rate-limited" });

    // The allowance is keyed by the account, never by address: another
    // account on the same test connection writes normally.
    const other = await freshUser("AgentOther");
    const otherCatalogue = await makeCatalogue(other.userId, { name: "Other" });
    const written = await update(other.userId, {
      catalogueId: otherCatalogue,
      name: "Other Renamed",
    });
    expect(written.name).toBe("Other Renamed");
  });
});

describe("the tier cap", () => {
  it("relays limit-reached at ten owned Catalogues and writes no eleventh", async () => {
    const capped = await freshUser("AgentCapped");
    await seedCatalogues(capped.userId, CATALOGUE_LIMITS.free);

    const refusal = await call(capped.userId, "create_catalogue", {
      name: "The Eleventh",
      kind: "collection",
    }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ApiError);
    // The same code and status the route answers: terminal for the agent,
    // which is told to relay it to the person rather than retry.
    expect(refusal).toMatchObject({ code: "limit-reached", status: 409 });
    expect(await listedCatalogueCount(capped.userId)).toBe(
      CATALOGUE_LIMITS.free,
    );
  });
});
