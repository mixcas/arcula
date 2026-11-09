// The delete service at the transport boundary: a `204` has no body, so the
// request core must answer the successful write rather than fail parsing an
// empty stream. The settings-page test mocks this service, so nothing else
// would notice the transport regressing on a bodiless answer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/services/api";
import { collectionService } from "@/services/collectionService";

const stubFetch = (response: Response) => {
  const fetchMock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collectionService.deleteCollection", () => {
  it("resolves a bodiless 204 as the completed delete", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));

    await expect(
      collectionService.deleteCollection("abc"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/collections/abc", {
      method: "DELETE",
    });
  });

  it("rejects a refusal with the API's own message", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          error: {
            code: "forbidden",
            message: "Only the owner may delete this collection.",
          },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    );

    const error = await collectionService
      .deleteCollection("abc")
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 403,
      message: "Only the owner may delete this collection.",
    });
  });
});
