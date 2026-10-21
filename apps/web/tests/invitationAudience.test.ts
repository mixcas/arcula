import { describe, expect, it } from "vitest";
import { invitationAudience } from "@/utils/invitation";

/**
 * The one decision the invite page makes before offering anything: is this
 * account the invited one? The API compares addresses trimmed and lowercased,
 * and a page that compares them literally would either show "accept" to a
 * stranger (and earn a 403) or hide it from the invited account whose session
 * carries a differently-cased address.
 */
describe("invitationAudience", () => {
  it("is signed-out when there is no viewer", () => {
    expect(invitationAudience("Invited@Example.Test", null)).toBe("signed-out");
  });

  it("matches the same address through case and surrounding space", () => {
    expect(
      invitationAudience("Invited@Example.Test", {
        email: "  invited@example.test ",
      }),
    ).toBe("matching");
  });

  it("is mismatched for another address", () => {
    expect(
      invitationAudience("invited@example.test", {
        email: "someone-else@example.test",
      }),
    ).toBe("mismatched");
  });

  it("is mismatched, never matching, when either side has no address", () => {
    // A viewer without an email must not accept; an empty invited address is a
    // malformed preview, not a wildcard.
    expect(invitationAudience("invited@example.test", { email: null })).toBe(
      "mismatched",
    );
    expect(invitationAudience("", { email: null })).toBe("mismatched");
  });
});
