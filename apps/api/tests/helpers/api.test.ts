// The one rule in the shared transport helpers that is ours rather than the
// platform's: which Set-Cookie entries are a session. A response that clears a
// cookie is answering with a deletion, and sending that deletion back as a
// Cookie header is not "no session" — it is a session the server cannot see.
// It reads as harmless in review, and no suite signs out, so this is where the
// rule is pinned.

import { describe, expect, it } from "vitest";
import { sessionCookies } from "./api";

describe("sessionCookies", () => {
  it("keeps the live cookies and drops a deletion", () => {
    const res = new Response(null, {
      headers: [
        ["Set-Cookie", "session=live; Path=/; Max-Age=3600; HttpOnly"],
        ["Set-Cookie", "other=kept; Path=/"],
        ["Set-Cookie", "session=; Path=/; Max-Age=0"],
      ],
    });

    expect(sessionCookies(res)).toBe("session=live; other=kept");
  });
});
