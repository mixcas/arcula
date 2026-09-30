import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The client-facing facts in `storage.rules`, read out of the rules themselves.
 *
 * The rules are the server's half of a contract the client also has to honour:
 * the names an upload may be written under, the extensions those names may end
 * in, and the ceilings an upload is measured against. Each of those exists in
 * two files and nothing about editing one reminds you of the other.
 *
 * That gap has already cost an outage. A `.bin` PDF name went straight through
 * once — 100% of PDF uploads 403'd while images worked, which reads as "the
 * rules are wrong" rather than "the client is wrong". Hence parsed rather than
 * written out here as literals: a literal in this file would be a *third* copy,
 * agreeing with whichever copy somebody remembered to update.
 *
 * A helper rather than a copy per file for the same reason `carouselMock.tsx`
 * is one — three test files need this, and duplication is how copies drift.
 */

/** The rules source, read once per worker. */
const source = readFileSync(
  fileURLToPath(new URL("../../storage.rules", import.meta.url)),
  "utf8",
);

/**
 * One `function name(...) { … }` body.
 *
 * Cut at the next declaration rather than brace-matched: none of these functions
 * nests, and a brace counter would be a parser written for one file.
 */
const functionBody = (fn: string): string => {
  const start = source.indexOf(`function ${fn}(`);
  if (start === -1) {
    throw new Error(`no ${fn} in storage.rules`);
  }
  const next = source.indexOf("\n    function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
};

/**
 * A name pattern from the rules, as a JavaScript `RegExp`.
 *
 * The rules write theirs as a concatenation — `"^" + artworkId + "_[…]$"` —
 * because that is how a pattern interpolates a path parameter. Three details
 * are load-bearing:
 *
 * - `artworkId` sits *between* two literals, so joining the literals alone
 *   yields a pattern expecting a name starting with `_`, which rejects every
 *   object the app can legitimately write.
 * - `\\.` is escaped for the *rules* language; `RegExp` wants one backslash.
 *   Unhalved it reads as a literal backslash then "any character", and no name
 *   matches at all.
 * - the id is substituted unescaped, which is what the rules themselves do. A
 *   Firestore id is alphanumeric, and escaping it here would let the rules grow
 *   a metacharacter the client never emits without a test noticing.
 */
export const rulesNamePattern = (
  fn: "isPhotoName" | "isDocumentName",
  artworkId: string,
): RegExp => {
  const body = functionBody(fn);
  const open = body.indexOf("fileName.matches(");
  if (open === -1) {
    throw new Error(`no name pattern found in ${fn}`);
  }
  // Paren-balanced, because the pattern contains groups of its own. Depth starts
  // at 1 for the `matches(` paren this scan begins *inside*, so the pattern's
  // first `(` opens a group instead of appearing to close the call.
  const callStart = open + "fileName.matches(".length;
  let depth = 1;
  let callEnd = callStart;
  for (; callEnd < body.length; callEnd += 1) {
    if (body[callEnd] === "(") depth += 1;
    if (body[callEnd] === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  // Split on the `+` joiners rather than stripping quotes and hoping: the
  // pattern's vocabulary is keys and extensions, none of which contains a `+`.
  // The id is substituted after the split, so an id cannot introduce one.
  const expression = body
    .slice(callStart, callEnd)
    .split("+")
    .map((part) => part.replaceAll('"', "").trim())
    .join("")
    .replaceAll("artworkId", artworkId)
    .replaceAll("\\\\", "\\");
  return new RegExp(expression);
};

/** The key alternation — the variant names plus `original`. First group after the id. */
export const rulesKeyList = (
  fn: "isPhotoName" | "isDocumentName",
): string[] => {
  const alternation = /_\(([^)]+)\)/.exec(functionBody(fn));
  if (!alternation) {
    throw new Error(`could not read the key list out of ${fn}`);
  }
  return alternation[1].split("|");
};

/**
 * The extension alternation. Second group, after the literal `\.`.
 *
 * Documents add `pdf` and nothing else. That is a stored-XSS control rather than
 * tidiness: `contentType` is client-supplied and forgeable, so the name is the
 * only thing the rule can bind the declared type to.
 */
export const rulesExtensionList = (
  fn: "isPhotoName" | "isDocumentName",
): string[] => {
  const alternation = /\\\.\(([^)]+)\)/.exec(functionBody(fn));
  if (!alternation) {
    throw new Error(`could not read the extension list out of ${fn}`);
  }
  return alternation[1].split("|");
};

/**
 * The per-file byte ceiling an `acceptable*Upload()` enforces.
 *
 * Read as the number in `request.resource.size <= N * 1024 * 1024`. Changing
 * that unit is exactly the edit a literal here would miss, and it is the edit
 * that decides whether the form's own cap agrees with the server's.
 */
export const rulesByteCeiling = (
  fn: "acceptablePhotoUpload" | "acceptableDocumentUpload",
): number => {
  const ceiling = /request\.resource\.size <= (\d+) \* 1024 \* 1024/.exec(
    functionBody(fn),
  );
  if (!ceiling) {
    throw new Error(`could not read a byte ceiling out of ${fn}`);
  }
  return Number(ceiling[1]) * 1024 * 1024;
};
