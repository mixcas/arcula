// API integration: the Collection PDF's fallback font.
//
// The route is public and answers a TrueType subset of the bundled Noto Sans
// SC. The magic number is a correctness floor, not a subsetter test: the PDF
// embedder cannot take a WOFF2, and that failure would otherwise be silent.
// Glyph outlines are harfbuzz's business and are not asserted.

import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "../src/db";
import { err, req } from "./helpers/api";

afterAll(async () => {
  await closeDb();
});

/** 0x00010000 for a plain TTF, or the `true` tag a subsetter may emit. */
async function magicOf(res: Response): Promise<number> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect(bytes.length).toBeGreaterThanOrEqual(4);
  return new DataView(bytes.buffer).getUint32(0);
}

function nonAscii(count: number): string {
  // A run of distinct CJK code points, all beyond 0x7e and well inside the
  // fallback face's coverage.
  return Array.from({ length: count }, (_, index) =>
    String.fromCodePoint(0x4e00 + index),
  ).join("");
}

describe("GET /api/v1/pdf/font-fallback", () => {
  it("answers a TrueType subset as font/ttf without a session", async () => {
    const text = "☆⼺áé";
    const res = await req(
      "GET",
      `/api/v1/pdf/font-fallback?text=${encodeURIComponent(text)}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("font/ttf");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    // A Visitor's export needs this route: no session was established, and
    // none is demanded.
    expect(res.headers.get("set-cookie")).toBeNull();
    expect([0x00010000, 0x74727565]).toContain(await magicOf(res));
  });

  it("accepts exactly the 512-code-point cap", async () => {
    const res = await req(
      "GET",
      `/api/v1/pdf/font-fallback?text=${encodeURIComponent(nonAscii(512))}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("font/ttf");
  });

  it("answers 400 validation for empty text", async () => {
    const res = await req("GET", "/api/v1/pdf/font-fallback?text=");
    expect(res.status).toBe(400);
    expect((await err(res)).code).toBe("validation");
  });

  it("answers 400 validation when text is missing", async () => {
    const res = await req("GET", "/api/v1/pdf/font-fallback");
    expect(res.status).toBe(400);
    expect((await err(res)).code).toBe("validation");
  });

  it("answers 400 validation for ASCII-only text", async () => {
    const res = await req("GET", "/api/v1/pdf/font-fallback?text=abc");
    expect(res.status).toBe(400);
    expect((await err(res)).code).toBe("validation");
  });

  it("answers 400 validation for more than 512 distinct code points", async () => {
    const res = await req(
      "GET",
      `/api/v1/pdf/font-fallback?text=${encodeURIComponent(nonAscii(513))}`,
    );
    expect(res.status).toBe(400);
    expect((await err(res)).code).toBe("validation");
  });
});
