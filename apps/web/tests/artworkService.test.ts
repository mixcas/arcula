import { afterEach, describe, expect, it, vi } from "vitest";
import { artworkService } from "@/services/artworkService";

/**
 * The service's URLs, checked against the API's route table.
 *
 * The component suites stub the service (G8 — no MSW), and the API suites
 * pin their routes, so the seam in between — which URL a method actually
 * posts to — is the one spot neither side tests. That is where
 * `createArtworks` lived for a while: on the single-artwork CREATE route,
 * 400ing every import with "artworkId/title/artistName: expected string,
 * received undefined" — a validation error that says nothing about the
 * wrong URL. Node-side: the fetch stub intercepts before any relative URL
 * is resolved, so no transport setup is needed.
 */

interface Call {
  url: string;
  init: RequestInit;
}

const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const stubFetch = (answer: Response): Call[] => {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Promise.resolve(answer);
    }),
  );
  return calls;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createArtworks", () => {
  it("posts the {rows} envelope to the import route, not the create route", async () => {
    const rows = [{ title: "Estudio en rojo" }];
    const calls = stubFetch(ok({ inserted: 1, rejected: [] }));

    const outcome = await artworkService.createArtworks("c1", rows);

    expect(outcome).toEqual({ inserted: 1, rejected: [] });
    expect(calls).toHaveLength(1);
    // The pin: `/import/csv`, not the create route's `/artworks`.
    expect(calls[0]?.url).toBe("/api/v1/collections/c1/import/csv");
    expect(calls[0]?.init.method).toBe("POST");
    // apiRequest JSON-stringifies the body, so the string arm of BodyInit is
    // the one actually present — the cast documents that, and keeps
    // no-base-to-string away from a type that also admits blobs.
    const body = JSON.parse(calls[0]?.init.body as string) as {
      rows: unknown[];
    };
    expect(body).toEqual({ rows });
  });
});
