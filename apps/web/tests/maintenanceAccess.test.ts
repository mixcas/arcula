import { describe, expect, it } from "vitest";
import { isMaintenanceAdmin } from "@/utils/maintenanceAccess";

describe("isMaintenanceAdmin", () => {
  it("admits the allowlisted address", () => {
    expect(isMaintenanceAdmin("casska@gmail.com")).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    // Firebase's local part is case-insensitive in practice; a strict compare
    // would hide the screen from its own owner over a capital letter.
    expect(isMaintenanceAdmin("Casska@Gmail.com")).toBe(true);
    expect(isMaintenanceAdmin("  casska@gmail.com  ")).toBe(true);
  });

  it("refuses anyone else, including near-misses", () => {
    expect(isMaintenanceAdmin("someone@example.com")).toBe(false);
    expect(isMaintenanceAdmin("casska@gmail.co")).toBe(false);
    expect(isMaintenanceAdmin("evil+casska@gmail.com")).toBe(false);
    expect(isMaintenanceAdmin("casska@gmail.com.attacker.net")).toBe(false);
  });

  it("refuses a signed-in user with no email on their profile", () => {
    // A Firebase account created without an email must not slip through an
    // `undefined` that happens to stringify into a match.
    expect(isMaintenanceAdmin(null)).toBe(false);
    expect(isMaintenanceAdmin(undefined)).toBe(false);
    expect(isMaintenanceAdmin("")).toBe(false);
  });
});
