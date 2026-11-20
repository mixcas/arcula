import { describe, expect, it } from "vitest";

import {
  selectionAccessRefusalOutcome,
  selectionReadOutcome,
} from "@/components/pdf/selectionPdfAccess";
import { ApiRequestError } from "@/services/api";
import type { SelectionPublicRead } from "@arcula/shared";

/**
 * A refused photo is only a maybe: the Selection is read again and that read
 * decides whether the export may continue. The fold mirrors the Catalogue's,
 * with the Selection's own name in the challenge.
 */

const selectionRead: SelectionPublicRead = {
  selection: {
    id: "SSSSSSSSSSSSSSSSSSSS",
    name: "Winter shortlist",
    isPublic: true,
  },
  catalogueName: "Flores Solares",
  kind: "collection",
};

describe("selectionReadOutcome", () => {
  it("continues when the Selection is still readable", () => {
    expect(selectionReadOutcome(selectionRead)).toEqual({ status: "continue" });
  });

  it("is notFound when the Selection is gone", () => {
    expect(selectionReadOutcome(null)).toEqual({ status: "notFound" });
  });
});

describe("selectionAccessRefusalOutcome", () => {
  it("re-locks on a password-required refusal, naming the Selection", () => {
    const refusal = new ApiRequestError(
      403,
      "password-required",
      "Locked",
      undefined,
      { selectionName: "Winter shortlist" },
    );

    expect(selectionAccessRefusalOutcome(refusal)).toEqual({
      status: "locked",
      selectionName: "Winter shortlist",
    });
  });

  it("re-locks without a name when the refusal carries no usable detail", () => {
    const refusal = new ApiRequestError(403, "password-required", "Locked");

    expect(selectionAccessRefusalOutcome(refusal)).toEqual({
      status: "locked",
    });
  });

  it("is private on any other 403", () => {
    const refusal = new ApiRequestError(403, "forbidden", "Private");

    expect(selectionAccessRefusalOutcome(refusal)).toEqual({
      status: "private",
    });
  });

  it("treats a server failure as a broken image, not as lost access", () => {
    expect(
      selectionAccessRefusalOutcome(
        new ApiRequestError(500, "internal", "Boom"),
      ),
    ).toEqual({ status: "continue" });
  });

  it("treats a dropped connection as a broken image", () => {
    expect(
      selectionAccessRefusalOutcome(new TypeError("Failed to fetch")),
    ).toEqual({ status: "continue" });
  });
});
