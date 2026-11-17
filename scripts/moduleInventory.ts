/**
 * The shared package's surface list, as a check.
 *
 * `packages/shared/README.md` and `AGENTS.md` each claim to enumerate what the
 * package holds. A module that lands without a line in both is invisible to the
 * next reader, and no compiler or test notices: the module works, it just
 * cannot be found. This answers which modules are missing from which index, as
 * data, so the gate's CLI can fail on it.
 */

/** One index document and its text. `path` is repository-relative. */
export interface IndexDocument {
  path: string;
  text: string;
}

/** A module absent from one or more indexes. */
export interface UnindexedModule {
  module: string;
  /** The indexes that do not name it, in the order they were handed in. */
  missingFrom: string[];
}

/**
 * Every module in `modules` that at least one index fails to name.
 *
 * `modules` are filenames (`pdfFallback.ts`), so a mention anywhere in an index
 * counts. An empty result means every index knows every module.
 */
export function findUnindexedModules(
  modules: readonly string[],
  indexes: readonly IndexDocument[],
): UnindexedModule[] {
  return modules.flatMap((module) => {
    const missingFrom = indexes
      .filter((index) => !index.text.includes(module))
      .map((index) => index.path);
    return missingFrom.length === 0 ? [] : [{ module, missingFrom }];
  });
}
