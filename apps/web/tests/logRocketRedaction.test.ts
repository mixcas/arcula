import { describe, expect, it } from "vitest";
import { isSensitivePath } from "@/telemetry/logRocket";

/**
 * The redaction predicate is the one thing standing between a member's
 * password (or an invitation token, or a presigned upload URL) and the
 * recorder, and a missed route leaks silently — no test elsewhere would go
 * red. The absolute form is covered on purpose: the SDK may hand back the URL
 * a relative `fetch` resolved to.
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
    // The presign call: its RESPONSE body carries `uploadUrl`, a bearer token
    // for one staged object. The route carries no `media` segment, which is
    // why the media rule alone never covered it.
    "/api/v1/catalogues/abc/artworks/def/photos/stage",
    "/api/v1/catalogues/abc/artworks/def/documents/stage",
    // Process answers the staged original's proxy path and its variants.
    "/api/v1/catalogues/abc/artworks/def/photos/process",
    // The direct PUT to the bucket: a presigned URL is a bearer token, and
    // the request carries the signed `content-type` and `x-amz-meta-name`.
    // Path-style names the bucket first; virtual-hosted names it in the host.
    "http://localhost:9000/arcula/staging/up1/cat1/art1/entry1.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20261116%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261116T150500Z&X-Amz-Expires=300&X-Amz-SignedHeaders=content-type%3Bhost%3Bx-amz-meta-name&X-Amz-Signature=deadbeef",
    "https://arcula-media.s3.us-east-1.amazonaws.com/staging/up1/cat1/art1/entry1.jpg?X-Amz-Signature=deadbeef",
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
    // A storage URL that is not a staged object. The presigner only mints
    // staging keys, so this is not a token this app handed out — and matching
    // every bucket path would redact the media proxy's own reads.
    "https://arcula-media.s3.us-east-1.amazonaws.com/artworks/ns1/cat1/art1/photos/entry1_original.jpg",
    // `staging` as a segment must be the key prefix, not a word in a name.
    "/api/v1/catalogues/abc123/staging",
  ])("records %s", (url) => {
    expect(isSensitivePath(url)).toBe(false);
  });
});
