/**
 * The documentation pointer resolver.
 *
 * The navigation surface is the set of documents a reader — usually a coding
 * agent — is told to follow. A pointer in one of them that resolves to nothing
 * is a broken instruction: the reader follows it, finds nothing, and carries
 * on without the standard it was pointed at. This module answers which
 * pointers are dead, as data. It is pure: it takes the documents' `(path,
 * text)` pairs and an `exists` probe, so the suite can drive it over fixtures
 * and the CLI supplies the filesystem.
 *
 * Resolution policy — pinned by `scripts/tests/docsPointers.test.ts`:
 *
 * 1. A candidate is tried against the containing file's directory first, then
 *    against the repository root. A leading `/` means the repository root
 *    only. The fallback is what lets a document write `packages/shared/…`
 *    repo-relative while an ADR's `../../GLOSSARY.md` still resolves from its
 *    own directory: the first attempt catches a link written one `../` short,
 *    the second keeps today's root-relative style from becoming churn.
 * 2. An inline-code span counts as a pointer only when it names an anchor: a
 *    leading `/`, `./` or `../`, or a known top-level directory (`apps/`,
 *    `packages/`, `scripts/`, `infra/`, `docs/`, `.github/`, `.agents/`). A
 *    bare name or a directory shorthand (`routes/`, `media/`,
 *    `schemas/artwork.ts`, `src/App.tsx`) is skipped: it has no anchor, so the
 *    gate cannot tell a rename from shorthand, and AGENTS.md's "Where things
 *    live" map deliberately writes those bullets under a heading that names
 *    their base.
 * 3. A markdown link is always a pointer — the author wrote the link — so the
 *    anchor rule above does not apply to it. Only the URL, anchor, fence and
 *    placeholder skips do.
 *
 * A leading slash is also how prose writes an application route (`/collection/`,
 * `/api/health`), so a root-anchored pointer must name a file: the last segment
 * carries an extension. That is why the route examples above are not pointers
 * while a root-relative `/docs/adr/0003-….md` is.
 *
 * Two further shapes are not paths. A span containing whitespace is a command
 * line (`scripts/reset-dev.sh --yes`), because no repository path has one. A
 * `$`-prefixed span is a shell variable expansion (`$STAGE/assets/fonts/`), and
 * the gate cannot know what it expands to. Neither is a pointer.
 */

/** One document in the navigation surface. `path` is repository-relative. */
export interface SurfaceDocument {
  path: string;
  text: string;
}

/** A pointer that resolves nowhere, with where it was written. */
export interface DeadPointer {
  file: string;
  /** One-based line number in `file`. */
  line: number;
  /** The pointer as written (`<…>` wrapper removed). */
  pointer: string;
  /** The repository-relative path the resolver tried first. */
  resolved: string;
}

/**
 * The navigation surface, as an explicit decision rather than a directory
 * sweep, so a document a reader is told to follow is either added here or
 * deliberately left out. The root `AGENTS.md` is always loaded; `README.md` is
 * the contributor reference, and `DESIGN.md`, `GLOSSARY.md`, `docs/**` and the
 * four package instruction files are read where they apply.
 * `.agents/skills/**` is deliberately excluded: it is vendored, upstream
 * content pinned by `skills-lock.json`, and a pointer into it is not ours to
 * repair.
 */
export const DOCS_SURFACE = [
  "AGENTS.md",
  "README.md",
  "DESIGN.md",
  "GLOSSARY.md",
  "docs/**/*.md",
  "apps/api/AGENTS.md",
  "apps/web/AGENTS.md",
  "packages/db/AGENTS.md",
  "infra/cdk/AGENTS.md",
] as const;

/**
 * The top-level directories a pointer may be anchored by. Directories, not
 * files: a bare `README.md` is shorthand whose base the prose owns, while
 * `docs/README.md` names its own place.
 */
const ROOT_ANCHORS = [
  "apps",
  "packages",
  "scripts",
  "infra",
  "docs",
  ".github",
  ".agents",
];

/** A URL scheme (`https:`, `mailto:`, `data:`); never a repository path. */
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** A trailing `:line` or `:line:column`, which names a place inside a file. */
const LINE_SUFFIX = /:\d+(?::\d+)?$/;

/** Glob or placeholder punctuation: the span is a pattern, not a path. */
const PLACEHOLDER = /[*?{}<>…]/;

/** A fence opener or closer: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** A markdown link or image, capturing the target (an optional `<…>` wrapper included). */
const LINK = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/g;

/** An inline-code span: a run of backticks, its content, the same run again. */
const CODE = /(`+)([^`\n]+?)\1/g;

interface Candidate {
  line: number;
  pointer: string;
  from: "link" | "code";
}

interface Attempt {
  /** The repository-relative path tried first. */
  path: string;
  found: boolean;
}

/**
 * Every pointer in `documents` that does not resolve, in reading order.
 * `exists` answers for a repository-relative path, directories included.
 */
export function findDeadPointers(
  documents: readonly SurfaceDocument[],
  exists: (repositoryPath: string) => boolean,
): DeadPointer[] {
  const dead: DeadPointer[] = [];
  for (const document of documents) {
    for (const candidate of candidatesIn(document.text)) {
      const attempt = resolvePointer(candidate, document.path, exists);
      if (attempt === null || attempt.found) continue;
      dead.push({
        file: document.path,
        line: candidate.line,
        pointer: candidate.pointer,
        resolved: attempt.path,
      });
    }
  }
  return dead;
}

/** Pointers on lines outside a fenced block, in reading order. */
function candidatesIn(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const line of visibleLines(text)) {
    for (const match of line.text.matchAll(LINK)) {
      candidates.push({
        line: line.number,
        pointer: match[1] ?? "",
        from: "link",
      });
    }
    for (const match of line.text.matchAll(CODE)) {
      candidates.push({
        line: line.number,
        pointer: match[2] ?? "",
        from: "code",
      });
    }
  }
  return candidates;
}

/**
 * The document's lines with fenced code blocks removed. A fenced block is an
 * example, not a pointer, and Markdown allows both ``` and ~~~ fences.
 */
function* visibleLines(
  text: string,
): Generator<{ number: number; text: string }> {
  let fence: { marker: string; length: number } | null = null;
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const opener = FENCE.exec(line);
    if (fence !== null) {
      const closes =
        opener !== null &&
        opener[1]?.[0] === fence.marker &&
        opener[1].length >= fence.length;
      if (closes) fence = null;
      continue;
    }
    if (opener !== null) {
      fence = { marker: opener[1]?.[0] ?? "`", length: opener[1]?.length ?? 3 };
      continue;
    }
    yield { number: index + 1, text: line };
  }
}

/**
 * The path a candidate names, or null when it is not a repository path at all
 * (a URL, a bare anchor, a glob, a placeholder).
 */
function pointerPath(raw: string): string | null {
  let target = raw.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }
  if (target === "" || target.startsWith("#")) return null;
  if (URL_SCHEME.test(target)) return null;
  // A span with arguments (`scripts/reset-dev.sh --yes`) is a command line,
  // not a path. No repository path contains whitespace.
  if (/\s/.test(target)) return null;
  target = target.replace(/#.*$/, "");
  target = target.replace(LINE_SUFFIX, "");
  if (target === "" || target.startsWith("$")) return null;
  if (PLACEHOLDER.test(target)) return null;
  return target;
}

/** Whether an inline-code span names its own base (policy 2 in the header). */
function isAnchored(target: string): boolean {
  if (
    target.startsWith("/") ||
    target.startsWith("./") ||
    target.startsWith("../")
  ) {
    return true;
  }
  return ROOT_ANCHORS.includes(target.split("/")[0] ?? "");
}

/** Whether a root-anchored pointer names a file rather than a route. */
function namesAFile(target: string): boolean {
  const name = target.slice(target.lastIndexOf("/") + 1);
  return name.includes(".");
}

/** The repository-relative path a pointer tries first, and whether it exists. */
function resolvePointer(
  candidate: Candidate,
  fromFile: string,
  exists: (repositoryPath: string) => boolean,
): Attempt | null {
  const target = pointerPath(candidate.pointer);
  if (target === null) return null;
  if (candidate.from === "code" && !isAnchored(target)) return null;

  if (target.startsWith("/")) {
    if (!namesAFile(target)) return null;
    const path = joinPath("", target.slice(1));
    return { path, found: exists(path) };
  }

  const path = joinPath(directoryOf(fromFile), target);
  if (exists(path)) return { path, found: true };

  // The repository root is the second attempt: documentation writes
  // repository-relative paths without a leading slash.
  const fromRoot = joinPath("", target);
  return { path, found: exists(fromRoot) };
}

function directoryOf(file: string): string {
  const cut = file.lastIndexOf("/");
  return cut === -1 ? "" : file.slice(0, cut);
}

/** Join and normalise POSIX path segments; `.` and `..` are resolved. */
function joinPath(base: string, target: string): string {
  const segments = base === "" ? [] : base.split("/");
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else {
        segments.push("..");
      }
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}
