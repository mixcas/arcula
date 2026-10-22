// The Access grant's pure facts: the token that goes in the cookie, the hash
// that goes in the row, and the one question every read asks — "is this grant
// still usable?".

import { describe, expect, it } from "vitest";
import {
  hashGrantToken,
  isGrantUsable,
  mintGrantToken,
} from "../src/collectionGrants";

const NOW = new Date("2026-01-01T00:00:00Z");

describe("grant tokens", () => {
  it("mints a URL-safe token with enough entropy to be unguessable", () => {
    const first = mintGrantToken();
    const second = mintGrantToken();
    // base64url's alphabet only: no '+', '/', or '=' to escape in a cookie.
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it("stores a SHA-256 hash, never the token itself", () => {
    // An independent known vector: the digest of "abc" under SHA-256.
    expect(hashGrantToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const token = mintGrantToken();
    expect(hashGrantToken(token)).not.toBe(token);
  });
});

describe("isGrantUsable", () => {
  it("accepts a grant whose expiry is still in the future", () => {
    expect(isGrantUsable({ expiresAt: new Date(NOW.getTime() + 1) }, NOW)).toBe(
      true,
    );
  });

  it("refuses a grant whose expiry has passed or is the current instant", () => {
    expect(isGrantUsable({ expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toBe(
      false,
    );
    expect(isGrantUsable({ expiresAt: NOW }, NOW)).toBe(false);
  });
});
