// Artist Name suggestions, tier 1: the wire contract.
//
// The list is names alone and each is kept exactly as stored — the wire does
// not trim — but a blank spelling is a failed parse rather than an empty row in
// the dropdown. The server and the client parse through this one schema.

import { describe, expect, it } from "vitest";
import { artistNamesSchema } from "../src/schemas/artistNames";

describe("the Artist Name wire schema", () => {
  it("keeps a stored spelling exactly, surrounding whitespace included", () => {
    expect(artistNamesSchema.parse(["  Pablo Picasso  "])).toEqual([
      "  Pablo Picasso  ",
    ]);
  });

  it("rejects a name whose trimmed form is empty", () => {
    expect(() => artistNamesSchema.parse(["   "])).toThrow();
  });
});
