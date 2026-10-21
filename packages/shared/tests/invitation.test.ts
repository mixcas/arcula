// The invitation's clock, read on the wire. The API keeps the same two
// product durations (`packages/shared/src/invitationTime.ts`) so the card's
// "expired" badge and its disabled Resend button cannot disagree with the
// server's own refusal.

import { describe, expect, it } from "vitest";
import {
  INVITATION_RESEND_COOLDOWN_MS,
  invitationLapsed,
  invitationResendWaitMs,
} from "../src/invitationTime";

const NOW = Date.UTC(2026, 0, 1);
const at = (ms: number) => ({
  seconds: Math.floor(ms / 1000),
  nanoseconds: (ms % 1000) * 1e6,
});

describe("invitationLapsed", () => {
  it("treats the exact expiry instant as lapsed", () => {
    // The API's usable check is `expiresAt > now`: an offer at the instant is
    // already gone, and the card must show the same instant as expired.
    expect(invitationLapsed(at(NOW), NOW)).toBe(true);
    expect(invitationLapsed(at(NOW + 1), NOW)).toBe(false);
  });
});

describe("invitationResendWaitMs", () => {
  it("is the remainder of the cooldown, and zero from the exact instant on", () => {
    expect(invitationResendWaitMs(at(NOW), NOW)).toBe(
      INVITATION_RESEND_COOLDOWN_MS,
    );
    expect(invitationResendWaitMs(at(NOW - 20_000), NOW)).toBe(40_000);
    // The exact cooldown instant is already a fresh send (the API asks
    // `createdAt <= cutoff`), so nothing is left to wait.
    expect(
      invitationResendWaitMs(at(NOW - INVITATION_RESEND_COOLDOWN_MS), NOW),
    ).toBe(0);
    expect(
      invitationResendWaitMs(at(NOW - INVITATION_RESEND_COOLDOWN_MS - 1), NOW),
    ).toBe(0);
  });
});
