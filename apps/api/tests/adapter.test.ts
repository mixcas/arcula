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

  it("tier is required on write and defaults to the free tier", () => {
    expect(userAdditionalFields.tier.required).toBe(true);
    expect(userAdditionalFields.tier.defaultValue).toBe("free");
  });

  it("settings is the json freeform bag; the names are plain optional strings", () => {
    expect(userAdditionalFields.settings.type).toBe("json");
    expect(userAdditionalFields.settings.required).toBe(false);
    expect(userAdditionalFields.firstName.type).toBe("string");
    expect(userAdditionalFields.firstName.required).toBe(false);
    expect(userAdditionalFields.lastName.required).toBe(false);
  });

  it("the adapter is pointed at a schema that has all four core auth tables", () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining(["user", "session", "account", "verification"]),
    );
  });
});
