import { describe, expect, it } from "vitest";
import { findUnindexedModules, type IndexDocument } from "../moduleInventory";

const index = (path: string, text: string): IndexDocument => ({ path, text });

describe("findUnindexedModules", () => {
  it("finds nothing when every index names every module", () => {
    const modules = ["caps.ts", "slug.ts"];

    expect(
      findUnindexedModules(modules, [
        index("packages/shared/README.md", "- `caps.ts`\n- `slug.ts`"),
        index("AGENTS.md", "`caps.ts` and `slug.ts`"),
      ]),
    ).toEqual([]);
  });

  it("names the index that has not been updated", () => {
    expect(
      findUnindexedModules(
        ["pdfFallback.ts"],
        [
          index("packages/shared/README.md", "- `pdfFallback.ts`"),
          index("AGENTS.md", "no module here"),
        ],
      ),
    ).toEqual([{ module: "pdfFallback.ts", missingFrom: ["AGENTS.md"] }]);
  });

  it("names both indexes when neither knows the module", () => {
    expect(
      findUnindexedModules(
        ["newThing.ts"],
        [
          index("packages/shared/README.md", "- `caps.ts`"),
          index("AGENTS.md", "`caps.ts`"),
        ],
      ),
    ).toEqual([
      {
        module: "newThing.ts",
        missingFrom: ["packages/shared/README.md", "AGENTS.md"],
      },
    ]);
  });

  it("keeps the caller's module order", () => {
    const modules = ["b.ts", "a.ts"];

    expect(
      findUnindexedModules(modules, [index("AGENTS.md", "nothing")]).map(
        (gap) => gap.module,
      ),
    ).toEqual(modules);
  });
});
