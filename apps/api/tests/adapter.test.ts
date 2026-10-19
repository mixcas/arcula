// The opaque-sign-up gotcha, asserted: every column the Better
// Auth adapter is told about via `user.additionalFields` must exist on the
// schema's user table — and the other way around, the declared tier default
// must be the one the quota key (`COLLECTION_LIMITS`) keys on. Drift here
// fails sign-up in production with no useful error, which is exactly what
// this test exists to kill in CI.
//
// The live half — a real sign-in through the adapter — is not a test but
// the `db:reset` script: it signs the owner up and back in against the
// local compose DB.

import { getTableColumns } from "drizzle-orm";
import { schema, user } from "@arcula/db";
import { COLLECTION_LIMITS } from "@arcula/shared";
import { describe, expect, it } from "vitest";

// auth.ts builds the betterAuth instance at import, which needs a secret;
// point it at syntactic values and import dynamically so they are set first.
process.env.AUTH_SECRET = "test-secret-32-chars-minimum-xxxxxx";
process.env.DATABASE_URL ??= "postgres://arcula:arcula@localhost:5432/arcula";
const { userAdditionalFields } = await import("../src/auth");

const userColumns = getTableColumns(user);

describe("the adapter declaration and the schema agree", () => {
  it("every additionalFields key is a column of the user table", () => {
    for (const key of Object.keys(userAdditionalFields)) {
      expect(
        userColumns,
        `user table has no \`${key}\` column — sign-up would fail opaquely`,
      ).toHaveProperty(key);
    }
  });

  it("declares types and required-ness that mirror the user table", () => {
    // Read off the columns, never restated: the declaration exists to describe
    // the schema, so a literal here would just be a third copy to keep in
    // step. `required` must match NOT NULL — a required field sitting over a
    // nullable column is the drift that fails sign-up with no useful error.
    const keys = Object.keys(
      userAdditionalFields,
    ) as (keyof typeof userAdditionalFields)[];
    for (const key of keys) {
      expect(userAdditionalFields[key].type, `${key}.type`).toBe(
        userColumns[key].dataType,
      );
      expect(userAdditionalFields[key].required, `${key}.required`).toBe(
        userColumns[key].notNull,
      );
    }
  });

  it("defaults a new account to a tier the quota table keys on", () => {
    // The default must be a key of COLLECTION_LIMITS: a default outside the
    // table falls through `collectionLimitForTier` to `undefined` (limits.ts),
    // so every new account would be uncapped and nothing would raise.
    expect(userAdditionalFields.tier.defaultValue).toBe(
      userColumns.tier.default,
    );
    expect(Object.keys(COLLECTION_LIMITS)).toContain(
      userAdditionalFields.tier.defaultValue,
    );
  });

  it("the adapter is pointed at a schema that has all four core auth tables", () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining(["user", "session", "account", "verification"]),
    );
  });
});
