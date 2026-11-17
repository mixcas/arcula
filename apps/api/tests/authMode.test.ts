// The bearer form's rule, as a predicate rather than an instance.
//
// A session token in an `Authorization: Bearer` header is the second,
// undeclared credential (ADR-0013): a deployment does not accept it, local
// development and the suites do. `auth.ts` mounts Better Auth's bearer plugin
// from this predicate, so the rule is testable without constructing a second
// auth instance — and the deployed side is asserted end-to-end by
// scripts/deploy-verify.ts.

import { describe, expect, it } from "vitest";
import { bearerAuthAllowed } from "../src/env";

describe("the session token as an API bearer", () => {
  it("is refused in production and kept everywhere else", () => {
    expect(bearerAuthAllowed("production")).toBe(false);
    expect(bearerAuthAllowed("development")).toBe(true);
    expect(bearerAuthAllowed("test")).toBe(true);
    // Only the literal `production` closes the gate: a local process that
    // never set NODE_ENV is still a laptop, not a deploy, and the Lambda sets
    // both the env var and the bundle's define.
    expect(bearerAuthAllowed(undefined)).toBe(true);
  });
});
