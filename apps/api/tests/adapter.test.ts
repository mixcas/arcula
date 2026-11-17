// The opaque-sign-up gotcha, asserted: every column the Better
// Auth adapter is told about via `user.additionalFields` must exist on the
// schema's user table — and the other way around, the declared tier default
// must be the one the quota key (`CATALOGUE_LIMITS`) keys on. Drift here
// fails sign-up in production with no useful error, which is exactly what
// this test exists to kill in CI.
//
// The live half — a real sign-in through the adapter — is not a test but
// the `db:reset` script: it signs the owner up and back in against the
// local compose DB.

import { getTableColumns } from "drizzle-orm";
import { schema, user } from "@arcula/db";
import { CATALOGUE_LIMITS } from "@arcula/shared";
import { getAuthTables } from "better-auth/db";
import type { BetterAuthOptions } from "better-auth/types";
import { describe, expect, it } from "vitest";

// auth.ts builds the betterAuth instance at import, which needs a secret;
// point it at syntactic values and import dynamically so they are set first.
process.env.AUTH_SECRET = "test-secret-32-chars-minimum-xxxxxx";
process.env.DATABASE_URL ??= "postgres://arcula:arcula@localhost:5432/arcula";
process.env.AUTH_BASE_URL ??= "http://localhost:8000";
process.env.CLIENT_ORIGIN ??= "http://localhost:3000";
const { auth, userAdditionalFields } = await import("../src/auth");

const userColumns = getTableColumns(user);

// The plugin models are hand-authored because @better-auth/cli is deprecated
// with no 1.7.x release. `getAuthTables()` is the generator this repository
// does not have: it runs with no database and returns exactly the models and
// fields the adapter will address. A model it cannot find fails the first
// request with `The model "…" was not found in the schema object`, so this is
// the same class of opaque failure the custom-user-column test above kills.
const authTables = getAuthTables(auth.options as BetterAuthOptions);

// The adapter compares types loosely but the driver does not: a `string[]`
// written into a scalar `text` column corrupts silently, and a `date` written
// into `text` reads back as an unusable string. One mapping, asserted per
// field.
const DRIZZLE_TYPE: Record<string, string> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  date: "date",
  json: "json",
  "string[]": "array",
};

describe("every model Better Auth writes exists in the Drizzle schema", () => {
  it("names a table for each of the plugin models", () => {
    for (const model of Object.keys(authTables)) {
      expect(
        Object.keys(schema),
        `the adapter has no table named \`${model}\` — every request fails`,
      ).toContain(model);
    }
  });

  it("has every declared field as a column, with the declared type", () => {
    for (const [model, table] of Object.entries(authTables)) {
      const columns = getTableColumns(
        schema[model as keyof typeof schema] as never,
      );
      for (const [key, field] of Object.entries(table.fields)) {
        const name = field.fieldName || key;
        const column = columns[name];
        expect(column, `${model}.${name} is missing`).toBeDefined();
        const expected = DRIZZLE_TYPE[field.type];
        expect(
          expected,
          `unknown Better Auth type ${field.type}`,
        ).toBeDefined();
        expect(column.dataType, `${model}.${name} type`).toBe(expected);
      }
    }
  });

  it("carries the two plugin models the MCP surface reads by name", () => {
    // The guard reads `oauthConsent`, and the Connection record is a family of
    // `oauthRefreshToken` rows. Naming them here is the one place a rename of
    // either plugin model fails before a request does.
    expect(Object.keys(authTables)).toEqual(
      expect.arrayContaining(["oauthConsent", "oauthRefreshToken"]),
    );
  });
});

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
    // The default must be a key of CATALOGUE_LIMITS: a default outside the
    // table falls through `catalogueLimitForTier` to `undefined` (limits.ts),
    // so every new account would be uncapped and nothing would raise.
    expect(userAdditionalFields.tier.defaultValue).toBe(
      userColumns.tier.default,
    );
    expect(Object.keys(CATALOGUE_LIMITS)).toContain(
      userAdditionalFields.tier.defaultValue,
    );
  });

  it("the adapter is pointed at a schema that has all four core auth tables", () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining(["user", "session", "account", "verification"]),
    );
  });
});
