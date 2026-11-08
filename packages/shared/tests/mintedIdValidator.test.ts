// The validator that governs client-minted ids and upload entry ids. Its
// accepted set is exactly the characters the shared mint can emit — plus the
// 32-character hex ids minted before the mint existed, which are never
// rewritten. The hyphen's absence is what the route parser depends on, so it
// is asserted here rather than left to the API suite, which needs the local
// stack.

import { describe, expect, it } from "vitest";
import { MINTED_ID_RE } from "../src/schemas/artwork";

describe("MINTED_ID_RE", () => {
  it("accepts a minted ten-character base62 id", () => {
    expect(MINTED_ID_RE.test("aB3d9Kx2Qp")).toBe(true);
  });

  it("accepts a legacy 32-character hex id, so existing rows keep validating", () => {
    expect(MINTED_ID_RE.test("7592e1379087442c861caad264a5d0fb")).toBe(true);
  });

  it("rejects an id containing a hyphen", () => {
    // `parseId` cuts at the last hyphen; a hyphen inside an id would put the
    // cut inside the id itself.
    expect(MINTED_ID_RE.test("aB3d9-Kx2Qp")).toBe(false);
  });

  it("rejects an id containing an underscore", () => {
    expect(MINTED_ID_RE.test("aB3d9_Kx2Qp")).toBe(false);
  });
});
