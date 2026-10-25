import { describe, expect, it } from "vitest";

import {
  accessRefusalOutcome,
  collectionReadOutcome,
} from "@/components/pdf/collectionPdfAccess";
import { ApiRequestError } from "@/services/api";
import type { Collection } from "@arcula/shared";

const collection = { id: "collection-1", name: "Flores" } as Collection;

describe("collectionReadOutcome", () => {
  it("continues when the Collection is still readable", () => {
    expect(collectionReadOutcome(collection)).toEqual({ status: "continue" });
  });

  it("is notFound when the Collection is gone", () => {
    expect(collectionReadOutcome(null)).toEqual({ status: "notFound" });
  });
});

describe("accessRefusalOutcome", () => {
  it("re-locks on a password-required refusal, naming the collection", () => {
    const refusal = new ApiRequestError(
      403,
      "password-required",
      "Locked",
      undefined,
      {
        collectionName: "Flores Solares",
      },
    );

    expect(accessRefusalOutcome(refusal)).toEqual({
      status: "locked",
      collectionName: "Flores Solares",
    });
  });

  it("re-locks without a name when the refusal carries no usable detail", () => {
    const refusal = new ApiRequestError(403, "password-required", "Locked");

    expect(accessRefusalOutcome(refusal)).toEqual({ status: "locked" });
  });

  it("is private on any other 403", () => {
    const refusal = new ApiRequestError(403, "forbidden", "Private");

    expect(accessRefusalOutcome(refusal)).toEqual({ status: "private" });
  });

  it("treats a server failure as a broken image, not as lost access", () => {
    expect(
      accessRefusalOutcome(new ApiRequestError(500, "internal", "Boom")),
    ).toEqual({ status: "continue" });
  });

  it("treats a dropped connection as a broken image", () => {
    expect(accessRefusalOutcome(new TypeError("Failed to fetch"))).toEqual({
      status: "continue",
    });
  });
});
