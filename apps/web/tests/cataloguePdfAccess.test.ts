import { describe, expect, it } from "vitest";

import {
  accessRefusalOutcome,
  catalogueReadOutcome,
} from "@/components/pdf/cataloguePdfAccess";
import { ApiRequestError } from "@/services/api";
import type { Catalogue } from "@arcula/shared";

const catalogue = { id: "catalogue-1", name: "Flores" } as Catalogue;

describe("catalogueReadOutcome", () => {
  it("continues when the Catalogue is still readable", () => {
    expect(catalogueReadOutcome(catalogue)).toEqual({ status: "continue" });
  });

  it("is notFound when the Catalogue is gone", () => {
    expect(catalogueReadOutcome(null)).toEqual({ status: "notFound" });
  });
});

describe("accessRefusalOutcome", () => {
  it("re-locks on a password-required refusal, naming the catalogue", () => {
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
      catalogueName: "Flores Solares",
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
