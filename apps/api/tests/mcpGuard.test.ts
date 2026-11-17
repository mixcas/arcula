// The guard's two pure facts: the challenge's metadata pointer and when a
// connection's "last acted" may move. Both are our rules, not the library's —
// a wrong pointer sends a client to a 404, and a wrong interval turns a busy
// agent into one UPDATE per call.

import { describe, expect, it } from "vitest";
import {
  CONNECTION_TOUCH_INTERVAL_MS,
  consentTouchDue,
  resourceMetadataUrl,
} from "../src/mcp/guard";

describe("resourceMetadataUrl", () => {
  it("inserts the resource's path under the well-known document", () => {
    expect(resourceMetadataUrl("https://arcula.art/api/mcp")).toBe(
      "https://arcula.art/.well-known/oauth-protected-resource/api/mcp",
    );
  });

  it("drops a trailing slash before inserting", () => {
    expect(resourceMetadataUrl("https://arcula.art/api/mcp/")).toBe(
      "https://arcula.art/.well-known/oauth-protected-resource/api/mcp",
    );
  });
});

describe("consentTouchDue", () => {
  const lastTouched = new Date("2026-11-17T12:00:00.000Z");

  it("moves a stale connection's timestamp", () => {
    expect(
      consentTouchDue(
        lastTouched,
        new Date(lastTouched.getTime() + CONNECTION_TOUCH_INTERVAL_MS),
      ),
    ).toBe(true);
  });

  it("leaves a recently touched one alone", () => {
    expect(
      consentTouchDue(
        lastTouched,
        new Date(lastTouched.getTime() + CONNECTION_TOUCH_INTERVAL_MS - 1),
      ),
    ).toBe(false);
  });
});
