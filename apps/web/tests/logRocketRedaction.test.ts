import { describe, expect, it } from "vitest";
import { isSensitivePath } from "@/telemetry/logRocket";

/**
 * The redaction predicate is the one thing standing between a member's
 * password (or an invitation token) and the recorder, and a missed route
 * leaks silently — no test elsewhere would go red. The absolute form is
 * covered on purpose: the SDK may hand back the URL a relative `fetch`
 * resolved to.
 */
describe("isSensitivePath", () => {
  it.each([
    "https://arcula.art/api/auth/sign-in/email",
    "/api/auth/sign-up/email",
    "/api/auth/change-password",
    "/api/v1/catalogues/abc123/unlock",
    "/api/v1/invitations",
    "/api/v1/invitations/some-token",
    "/api/v1/invitations/some-token/accept",
    "/api/v1/media?key=users%2Fabc%2Fphoto.jpg",
    "/api/v1/catalogues/abc/artworks/def/media/stage",
    "/api/v1/catalogues/abc/artworks/def/media/process",
  ])("redacts %s", (url) => {
    expect(isSensitivePath(url)).toBe(true);
  });

  it.each([
    "/api/v1/catalogues",
    "/api/v1/catalogues/abc123",
    "/api/v1/catalogues/abc123/artworks",
    // The unlock regex is anchored: a route that merely starts with the word
    // is the ordinary catalogue read, not the password write.
    "/api/v1/catalogues/abc123/unlockable",
    "/api/v1/health",
    "/api/v1/me",
    "https://cdn.example.com/assets/app.js",
  ])("records %s", (url) => {
    expect(isSensitivePath(url)).toBe(false);
  });
});
