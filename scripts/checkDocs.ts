/**
 * The gate's half of the documentation pointer check: read the navigation
 * surface from disk, hand the resolver an `exists` probe, print one line per
 * dead pointer and exit non-zero. All the decisions live in `docsPointers.ts`;
 * this file is only the filesystem seam.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCS_SURFACE,
  findDeadPointers,
  type SurfaceDocument,
} from "./docsPointers";

/** The repository root, derived from this file rather than the caller's cwd. */
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

/** The surface's files, deduplicated and sorted for a stable report. */
function surfaceFiles(): string[] {
  const files = new Set<string>();
  for (const pattern of DOCS_SURFACE) {
    if (!pattern.includes("*")) {
      if (existsSync(join(repositoryRoot, pattern))) files.add(pattern);
      continue;
    }
    const glob = new Bun.Glob(pattern);
    for (const file of glob.scanSync({
      cwd: repositoryRoot,
      onlyFiles: true,
    })) {
      files.add(file);
    }
  }
  return [...files].sort();
}

const files = surfaceFiles();
const documents: SurfaceDocument[] = files.map((path) => ({
  path,
  text: readFileSync(join(repositoryRoot, path), "utf8"),
}));

const dead = findDeadPointers(documents, (path) =>
  existsSync(join(repositoryRoot, path)),
);

if (dead.length > 0) {
  for (const pointer of dead) {
    console.error(
      `${pointer.file}:${pointer.line}: ${pointer.pointer} does not resolve (${pointer.resolved})`,
    );
  }
  console.error(
    `\n${dead.length} dead documentation pointer${dead.length === 1 ? "" : "s"} in ${files.length} documents`,
  );
  process.exit(1);
}

console.log(`docs pointers: ${files.length} documents, every pointer resolves`);
