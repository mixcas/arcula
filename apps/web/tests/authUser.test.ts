// toArculaUser is the whole user-shape surface of the Phase 4 cutover:
// every owner-side query reads `currentUser.uid` (the Firebase alias), so
// a mapping that stops aliasing id -> uid breaks them silently. Pure and
// ours end to end — tier 1.

import { toArculaUser } from "@/auth/user";
import { describe, expect, it } from "vitest";

describe("toArculaUser", () => {
  it("aliases the session id to uid and carries the fields consumers read", () => {
    const user = toArculaUser({
      id: "abc123",
      email: "owner@example.test",
      emailVerified: true,
      name: "Cassandra",
    });
    expect(user.uid).toBe("abc123");
    expect(user.email).toBe("owner@example.test");
    expect(user.emailVerified).toBe(true);
    expect(user.displayName).toBe("Cassandra");
  });

  it("passes an absent name through as null rather than inventing one", () => {
    const user = toArculaUser({
      id: "x",
      email: "n@o.test",
      emailVerified: false,
      name: null,
    });
    expect(user.displayName).toBeNull();
    expect(user.emailVerified).toBe(false);
  });
});
