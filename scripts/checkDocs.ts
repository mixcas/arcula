/**
 * The gate's half of the documentation check: read the navigation surface from
 * disk, hand the resolver an `exists` probe, print one line per dead pointer
 * and exit non-zero; check the shared package's surface list the same way; then
 * hold every instruction file to its word ceiling. All the decisions live in
 * `docsPointers.ts`, `moduleInventory.ts` and `instructionBudget.ts`; this file
 * is only the filesystem seam.
 *
 * The instruction ceilings, and why they are these numbers:
 *
 * - The root `AGENTS.md` gets 800 words. It is the one file loaded on every
 *   request, so it must stay a pointer file — identity, the invariants an agent
 *   must not break, the test bar, and where to look. It sits well under the
 *   ceiling today (about 630 words), and the headroom is for a rule that
 *   genuinely belongs on every task.
 * - Each package `AGENTS.md` gets 400 words. A package file is disclosed only
 *   when an agent reads that package, so its cost is conditional; but it is a
 *   delta beside the package README and the architecture map, not a second
 *   manual. If it grows past 400 it is restating what its neighbours own.
 *
 * Because the ceilings live in the gate, raising one is an explicit edit with a
 * reviewer, not a silent paragraph. A document exactly at its ceiling passes:
 * the limit is the last allowed word, not the first forbidden one.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCS_SURFACE,
  findDeadPointers,
  type SurfaceDocument,
} from "./docsPointers";
import { findOverBudgetDocuments } from "./instructionBudget";
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

/**
 * The instruction files the gate holds to a ceiling, and the ceilings. The
 * reason for the two numbers is in this file's header.
 */
const INSTRUCTION_CEILINGS = [
  { path: "AGENTS.md", limit: 800 },
  { path: "apps/api/AGENTS.md", limit: 400 },
  { path: "apps/web/AGENTS.md", limit: 400 },
  { path: "packages/db/AGENTS.md", limit: 400 },
  { path: "infra/cdk/AGENTS.md", limit: 400 },
] as const;

const absentInstructions = INSTRUCTION_CEILINGS.filter(
  ({ path }) => !exists(path),
);

// A renamed or deleted instruction file would otherwise surface as an ENOENT
// stack trace, which reads like a crashed gate rather than a stale list.
if (absentInstructions.length > 0) {
  for (const { path } of absentInstructions) {
    console.error(
      `instruction budgets: ${path} is listed with a ceiling but does not exist`,
    );
  }
  console.error(
    `\n${absentInstructions.length} expected instruction file${absentInstructions.length === 1 ? "" : "s"} missing from the tree`,
  );
  process.exit(1);
}

const instructionDocuments = INSTRUCTION_CEILINGS.map(({ path, limit }) => ({
  path,
  limit,
  text: readFileSync(join(repositoryRoot, path), "utf8"),
}));

const overBudget = findOverBudgetDocuments(instructionDocuments);

if (overBudget.length > 0) {
  for (const document of overBudget) {
    console.error(
      `${document.file}: ${document.words} words, ceiling ${document.limit}`,
    );
  }
  console.error(
    `\n${overBudget.length} instruction document${overBudget.length === 1 ? "" : "s"} over its word ceiling`,
  );
  process.exit(1);
}

console.log(
  `instruction budgets: ${instructionDocuments.length} documents within their ceilings`,
);
