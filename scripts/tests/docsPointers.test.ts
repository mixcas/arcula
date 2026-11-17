import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DOCS_SURFACE,
  findDeadPointers,
  type SurfaceDocument,
} from "../docsPointers";

/** The repository root, derived from this suite's own location. */
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * An `exists` probe over a fixture tree. A directory is implied by the files
 * under it, so a fixture lists files only.
 */
const tree =
  (...files: string[]) =>
  (path: string): boolean =>
    files.some((file) => file === path || file.startsWith(`${path}/`));

const document = (path: string, text: string): SurfaceDocument => ({
  path,
  text,
});

describe("findDeadPointers", () => {
  it("resolves a markdown link against the containing file's directory", () => {
    const dead = findDeadPointers(
      [document("AGENTS.md", "The record is [DESIGN.md](DESIGN.md).")],
      tree("DESIGN.md"),
    );

    expect(dead).toEqual([]);
  });

  it("walks a ../ markdown link up from the containing file", () => {
    const dead = findDeadPointers(
      [
        document(
          "docs/adr/0003-the-collection-gates.md",
          "The vocabulary is in [GLOSSARY.md](../../GLOSSARY.md).",
        ),
      ],
      tree("GLOSSARY.md"),
    );

    expect(dead).toEqual([]);
  });

  it("reports a ../ link written one level short of the target", () => {
    const dead = findDeadPointers(
      [
        document(
          "docs/adr/0003-the-collection-gates.md",
          "line one\nThe vocabulary is in [GLOSSARY.md](../GLOSSARY.md).",
        ),
      ],
      tree("GLOSSARY.md"),
    );

    expect(dead).toEqual([
      {
        file: "docs/adr/0003-the-collection-gates.md",
        line: 2,
        pointer: "../GLOSSARY.md",
        resolved: "docs/GLOSSARY.md",
      },
    ]);
  });

  it("resolves a leading / from the repository root, not the containing directory", () => {
    const dead = findDeadPointers(
      [
        document(
          "docs/mail.md",
          "Read `/docs/adr/0003-the-collection-gates.md`.",
        ),
      ],
      tree("docs/adr/0003-the-collection-gates.md"),
    );

    expect(dead).toEqual([]);
  });

  it("falls back to the repository root for an inline-code path", () => {
    const dead = findDeadPointers(
      [
        document(
          "docs/adr/0007-ids-are-ten-base62-characters.md",
          "The mint is in `packages/shared/src/ids.ts`.",
        ),
      ],
      tree("packages/shared/src/ids.ts"),
    );

    expect(dead).toEqual([]);
  });

  it("reports a missing target with its file and line", () => {
    const dead = findDeadPointers(
      [
        document(
          "docs/specs/example.md",
          "one\ntwo\nSee `apps/api/src/gone.ts`.\n",
        ),
      ],
      tree("apps/api/src/access.ts"),
    );

    expect(dead).toEqual([
      {
        file: "docs/specs/example.md",
        line: 3,
        pointer: "apps/api/src/gone.ts",
        resolved: "docs/specs/apps/api/src/gone.ts",
      },
    ]);
  });

  it("skips an absolute URL in a link and in inline code", () => {
    const dead = findDeadPointers(
      [
        document(
          "README.md",
          "[map](https://github.com/mixcas/arcula/issues/125) and `https://example.com/x.md`.",
        ),
      ],
      tree(),
    );

    expect(dead).toEqual([]);
  });

  it("skips a bare anchor", () => {
    const dead = findDeadPointers(
      [document("DESIGN.md", "[Branches](#branches-and-environments).")],
      tree(),
    );

    expect(dead).toEqual([]);
  });

  it("skips a fenced code block, both backtick and tilde", () => {
    const dead = findDeadPointers(
      [
        document(
          "AGENTS.md",
          [
            "```sh",
            "cat docs/missing.md",
            "[x](docs/gone.md)",
            "```",
            "~~~",
            "`apps/api/src/gone.ts`",
            "~~~",
            "After the fence `apps/api/src/access.ts`.",
          ].join("\n"),
        ),
      ],
      tree("apps/api/src/access.ts"),
    );

    expect(dead).toEqual([]);
  });

  it("skips inline-code globs and placeholders", () => {
    const dead = findDeadPointers(
      [
        document(
          "AGENTS.md",
          "Globs and placeholders: `docs/**/*.md`, `docs/{a,b}.md`, `scripts/<name>.ts`, `docs/…`.",
        ),
      ],
      tree(),
    );

    expect(dead).toEqual([]);
  });

  it("strips a path:line suffix before resolving", () => {
    const dead = findDeadPointers(
      [document("AGENTS.md", "The sequence is in `scripts/deploy.sh:42`.")],
      tree("scripts/deploy.sh"),
    );

    expect(dead).toEqual([]);
  });

  it("strips an anchor suffix from a link", () => {
    const dead = findDeadPointers(
      [
        document(
          "docs/adr/0003-the-collection-gates.md",
          "See [the gates](0003-the-collection-gates.md#the-visitor-rule).",
        ),
      ],
      tree("docs/adr/0003-the-collection-gates.md"),
    );

    expect(dead).toEqual([]);
  });

  it("reports only the dead pointer when a document has one of each", () => {
    const dead = findDeadPointers(
      [
        document(
          "docs/specs/example.md",
          "See [the gates](../adr/0003-the-collection-gates.md) and `apps/api/src/gone.ts`.",
        ),
      ],
      tree("docs/adr/0003-the-collection-gates.md"),
    );

    expect(dead).toEqual([
      {
        file: "docs/specs/example.md",
        line: 1,
        pointer: "apps/api/src/gone.ts",
        resolved: "docs/specs/apps/api/src/gone.ts",
      },
    ]);
  });

  it("skips an inline-code span with no anchor", () => {
    const dead = findDeadPointers(
      [
        document(
          "AGENTS.md",
          "Under **`apps/api/src/`**: `routes/artworks.ts`, `media/stagedName.ts`, `telemetry/logRocket.ts`.",
        ),
      ],
      tree(
        "apps/api/src/routes/artworks.ts",
        "apps/api/src/media/stagedName.ts",
      ),
    );

    expect(dead).toEqual([]);
  });

  it("skips a leading-slash application route", () => {
    const dead = findDeadPointers(
      [
        document(
          "docs/specs/pdf-export.md",
          "The page is `/collection/` plus the slug.",
        ),
      ],
      tree(),
    );

    expect(dead).toEqual([]);
  });

  it("skips a span with whitespace, which is a command line", () => {
    const dead = findDeadPointers(
      [
        document(
          "AGENTS.md",
          "`scripts/reset-dev.sh --yes` drops the dev schema.",
        ),
      ],
      tree("scripts/reset-dev.sh"),
    );

    expect(dead).toEqual([]);
  });

  it("skips a $-prefixed span, which is a shell expansion", () => {
    // A code span starting with `$` is already skipped for having no anchor,
    // so only a link can reach this rule and pin it.
    const dead = findDeadPointers(
      [
        document(
          "docs/specs/pdf-export.md",
          "The fonts land in [$STAGE/assets/fonts/]($STAGE/assets/fonts/).",
        ),
      ],
      tree(),
    );

    expect(dead).toEqual([]);
  });
});

describe("DOCS_SURFACE", () => {
  it("names documents that exist, so a rename cannot shrink the surface", () => {
    for (const pattern of DOCS_SURFACE) {
      const matches = globSync(pattern, { cwd: repositoryRoot });

      expect(matches, `${pattern} matches nothing`).not.toEqual([]);
    }
  });
});
