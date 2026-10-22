// The unlock throttle's pure facts: where an attempt's fixed window starts.
// The counting itself lives in the unlock route, over the real table (its
// integration cases are in protectedCollection.api.test.ts); what is here is
// the policy, so a later reader can see the fixed-window choice without
// reading SQL.

import { describe, expect, it } from "vitest";
import { UNKNOWN_CLIENT_ADDRESS, clientAddress } from "../src/clientAddress";
import { unlockWindowStart } from "../src/unlockThrottle";

describe("unlockWindowStart", () => {
  it("floors an attempt to the start of its ten-minute window", () => {
    // 12:07:31 on a ten-minute grid → 12:00:00. The row names the span the
    // attempt belongs to, which is what makes the window fixed rather than
    // sliding.
    expect(unlockWindowStart(new Date("2026-01-01T12:07:31.250Z"))).toEqual(
      new Date("2026-01-01T12:00:00.000Z"),
    );
  });

  it("keeps an attempt exactly on a boundary in the window it opens", () => {
    const boundary = new Date("2026-01-01T12:10:00.000Z");
    expect(unlockWindowStart(boundary)).toEqual(boundary);
    expect(unlockWindowStart(new Date("2026-01-01T12:09:59.999Z"))).toEqual(
      new Date("2026-01-01T12:00:00.000Z"),
    );
  });
});

describe("clientAddress", () => {
  it("reads the gateway's address, and shares one bucket when there is none", () => {
    expect(clientAddress(" 203.0.113.7 ")).toBe("203.0.113.7");
    // Locally the Lambda entry is not in the loop, so the header is absent:
    // one bucket for one machine is the honest answer, and the throttle
    // still works for the only person using it.
    expect(clientAddress(undefined)).toBe(UNKNOWN_CLIENT_ADDRESS);
    expect(clientAddress("")).toBe(UNKNOWN_CLIENT_ADDRESS);
  });
});
