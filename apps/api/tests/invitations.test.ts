// The invitation's pure facts: the token that goes in the mail and the one
// question every link asks — "is this still an offer?".

import { describe, expect, it } from "vitest";
import {
  hashInvitationToken,
  isInvitationUsable,
  mintInvitationToken,
} from "../src/invitations";

const NOW = new Date("2026-01-01T00:00:00Z");
const FUTURE = new Date(NOW.getTime() + 1000);
const PAST = new Date(NOW.getTime() - 1000);

describe("invitation tokens", () => {
  it("mints a URL-safe token with enough entropy to be unguessable", () => {
    const first = mintInvitationToken();
    const second = mintInvitationToken();
    // base64url's alphabet only: no '+', '/', or '=' to escape in a path.
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it("stores a stable SHA-256 hash, never the token itself", () => {
    const token = mintInvitationToken();
    const hash = hashInvitationToken(token);
    expect(hash).toBe(hashInvitationToken(token));
    expect(hash).not.toBe(token);
  });
});

describe("isInvitationUsable", () => {
  it("accepts only a pending invitation that has not expired", () => {
    expect(
      isInvitationUsable({ status: "pending", expiresAt: FUTURE }, NOW),
    ).toBe(true);
    expect(
      isInvitationUsable({ status: "pending", expiresAt: PAST }, NOW),
    ).toBe(false);
    // The exact expiry instant is no longer usable.
    expect(isInvitationUsable({ status: "pending", expiresAt: NOW }, NOW)).toBe(
      false,
    );
  });

  it("treats every resolved status as history, whatever the clock says", () => {
    for (const status of ["accepted", "declined", "revoked"] as const) {
      expect(isInvitationUsable({ status, expiresAt: FUTURE }, NOW)).toBe(
        false,
      );
    }
  });
});
