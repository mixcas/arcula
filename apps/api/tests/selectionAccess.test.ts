// The Selection verdict, as a pure matrix.
//
// The one decision this file guards is that the source Catalogue's **visibility
// never enters the answer**. A Selection is a second gate, so a private
// Catalogue may still have a public Selection; only the Catalogue's deletion
// matters, and that is the loader's question rather than this predicate's. The
// matrix therefore varies the Catalogue's visibility against every cell and
// asserts no cell moves.
//
// Deletion is covered where it lives: `selectionPublic.api.test.ts` drives the
// real routes and proves a deleted Selection or a deleted source Catalogue
// answers not-found without a row being stamped.

import { describe, expect, it } from "vitest";

import type { Membership } from "../src/access";
import { errorResponse } from "../src/errors";
import {
  canSeeSelection,
  selectionRefusal,
  type SelectionFacts,
} from "../src/selectionAccess";

type CatalogueFacts = {
  userId: string;
  isPublic: boolean;
  passwordHash: string | null;
};

const catalogue = (
  overrides: Partial<CatalogueFacts> = {},
): CatalogueFacts => ({
  userId: "owner-1",
  isPublic: true,
  passwordHash: null,
  ...overrides,
});

const selection = (
  overrides: Partial<SelectionFacts> = {},
): SelectionFacts => ({
  catalogueId: "cat-1",
  name: "Fair 2026",
  isPublic: true,
  passwordHash: null,
  ...overrides,
});

/** Every source-Catalogue state the verdict must ignore. */
const CATALOGUES: CatalogueFacts[] = [
  catalogue({ isPublic: true, passwordHash: null }),
  catalogue({ isPublic: true, passwordHash: "scrypt$secret" }),
  catalogue({ isPublic: false, passwordHash: null }),
  catalogue({ isPublic: false, passwordHash: "scrypt$secret" }),
];

describe("canSeeSelection — the membership half", () => {
  it.each<Membership>(["owner", "collaborator"])(
    "lets a %s see every Selection, whatever its status",
    (membership) => {
      for (const source of CATALOGUES) {
        expect(
          canSeeSelection(membership, source, selection({ isPublic: false })),
        ).toBe(true);
        expect(
          canSeeSelection(membership, source, selection({ isPublic: true })),
        ).toBe(true);
        expect(
          canSeeSelection(
            membership,
            source,
            selection({ isPublic: true, passwordHash: "scrypt$secret" }),
          ),
        ).toBe(true);
      }
    },
  );
});

describe("canSeeSelection — the visitor half", () => {
  it("admits a public Selection with no password", () => {
    expect(canSeeSelection(null, catalogue(), selection())).toBe(true);
  });

  it("admits a public protected Selection only while holding a grant", () => {
    const protectedSelection = selection({ passwordHash: "scrypt$secret" });
    expect(canSeeSelection(null, catalogue(), protectedSelection)).toBe(false);
    expect(canSeeSelection(null, catalogue(), protectedSelection, true)).toBe(
      true,
    );
  });

  it("refuses a private Selection even with a grant", () => {
    // A grant is a condition on Public, never a third visibility state: it
    // cannot turn a private Selection into a readable one.
    expect(
      canSeeSelection(null, catalogue(), selection({ isPublic: false }), true),
    ).toBe(false);
  });
});

describe("canSeeSelection — the source Catalogue never moves an answer", () => {
  it("ignores its visibility, its password and even its owner", () => {
    const sourceStates: CatalogueFacts[] = [
      ...CATALOGUES,
      catalogue({ userId: "viewer-1", isPublic: false }),
    ];
    const selections: SelectionFacts[] = [
      selection({ isPublic: true }),
      selection({ isPublic: true, passwordHash: "scrypt$secret" }),
      selection({ isPublic: false }),
      selection({ isPublic: false, passwordHash: "scrypt$secret" }),
    ];
    const memberships: Membership[] = [null, "owner", "collaborator"];

    for (const membership of memberships) {
      for (const selected of selections) {
        for (const hasGrant of [false, true]) {
          const expected = canSeeSelection(
            membership,
            CATALOGUES[0],
            selected,
            hasGrant,
          );
          for (const source of sourceStates) {
            expect(
              canSeeSelection(membership, source, selected, hasGrant),
              `membership=${String(membership)} catalogue=${JSON.stringify(
                source,
              )} selection=${JSON.stringify(selected)} grant=${hasGrant}`,
            ).toBe(expected);
          }
        }
      }
    }
  });
});

describe("selectionRefusal — chosen from the Selection's own state", () => {
  it("challenges a public protected Selection and names it", () => {
    const refusal = selectionRefusal(
      selection({ isPublic: true, passwordHash: "scrypt$secret" }),
    );
    expect(refusal.code).toBe("password-required");
    expect(refusal.status).toBe(403);
    // The name must ride inside `details`: the envelope spreads a detail's keys
    // at the top level, and the client parses `error.details` to name the
    // screen. A flat third argument would land on `error.selectionName` and the
    // lock screen would show nothing.
    expect(errorResponse(refusal).body).toEqual({
      error: {
        details: { selectionName: "Fair 2026" },
        code: "password-required",
        message: expect.any(String) as string,
      },
    });
  });

  it("refuses a private Selection without naming it", () => {
    const refusal = selectionRefusal(selection({ isPublic: false }));
    expect(refusal.code).toBe("forbidden");
    expect(refusal.status).toBe(403);
    expect(refusal.details).toBeUndefined();
  });

  it("refuses a private Selection even when it carries a password", () => {
    // The password is a condition on Public; a private Selection is not a
    // challenge and never names itself.
    const refusal = selectionRefusal(
      selection({ isPublic: false, passwordHash: "scrypt$secret" }),
    );
    expect(refusal.code).toBe("forbidden");
    expect(refusal.details).toBeUndefined();
  });
});
