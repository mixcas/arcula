/**
 * The gate's half of the documentation check: read the navigation surface from
 * disk, hand the resolver an `exists` probe, print one line per dead pointer
 * and exit non-zero; then check the shared package's surface list the same way.
 * All the decisions live in `docsPointers.ts` and `moduleInventory.ts`; this
 * file is only the filesystem seam.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCS_SURFACE,
  findDeadPointers,
  type SurfaceDocument,
} from "./docsPointers";
import { findUnindexedModules } from "./moduleInventory";

/** The repository root, derived from this file rather than the caller's cwd. */
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

/** Whether a repository-relative path exists; directories included. */
const exists = (path: string): boolean =>
  existsSync(join(repositoryRoot, path));

/** The surface's files, deduplicated and sorted for a stable report. */
function surfaceFiles(): string[] {
  const files = new Set<string>();
  for (const pattern of DOCS_SURFACE) {
    if (pattern.includes("*")) {
      const glob = new Bun.Glob(pattern);
      for (const file of glob.scanSync({
        cwd: repositoryRoot,
        onlyFiles: true,
      })) {
        files.add(file);
      }
      continue;
    }
    if (exists(pattern)) files.add(pattern);
  }
  return [...files].sort();
}

const files = surfaceFiles();

// An empty surface would make the check pass by having read nothing, so a
// renamed navigation file has to fail here rather than go unnoticed.
if (files.length === 0) {
  console.error(
    `docs pointers: the navigation surface (${DOCS_SURFACE.join(", ")}) matched no documents`,
  );
  process.exit(1);
}

const documents: SurfaceDocument[] = files.map((path) => ({
  path,
  text: readFileSync(join(repositoryRoot, path), "utf8"),
}));

const dead = findDeadPointers(documents, exists);

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

/**
 * The shared package's two indexes: its own README, and the module map where
 * `AGENTS.md` sends a reader. Both claim to enumerate the package, so a module
 * absent from either is a surface list that has quietly drifted.
 */
const SHARED_INDEXES = [
  "packages/shared/README.md",
  "docs/architecture.md",
] as const;

const sharedModules = Array.from(
  new Bun.Glob("packages/shared/src/*.ts").scanSync({
    cwd: repositoryRoot,
    onlyFiles: true,
  }),
)
  .map((path) => basename(path))
  .filter((name) => name !== "index.ts")
  .sort();

const indexes = SHARED_INDEXES.map((path) => ({
  path,
  text: readFileSync(join(repositoryRoot, path), "utf8"),
}));

const unindexed = findUnindexedModules(sharedModules, indexes);

if (unindexed.length > 0) {
  for (const gap of unindexed) {
    console.error(`${gap.module}: not named in ${gap.missingFrom.join(", ")}`);
  }
  console.error(
    `\n${unindexed.length} shared module${unindexed.length === 1 ? "" : "s"} missing from an index`,
  );
  process.exit(1);
}

console.log(
  `shared surface: ${sharedModules.length} modules named in both indexes`,
);
