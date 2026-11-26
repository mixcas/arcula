/**
 * The instruction budget.
 *
 * An instruction file is read before the work starts, so every word in it is
 * paid on every task whether or not the task touches what the words describe.
 * A file that grows by a paragraph per change becomes a manual nobody
 * finishes, and the repository cannot tell a considered addition from
 * sediment. This module answers which documents are over the ceiling their
 * caller set, as data. It is pure: it takes the documents' `(path, text,
 * limit)` triples, so the suite can drive it over fixtures and the CLI supplies
 * the files and the ceilings.
 *
 * Measurement policy — pinned by `scripts/tests/instructionBudget.test.ts`:
 *
 * 1. A word is a whitespace-delimited token, the same measure `wc -w` uses: a
 *    maximal run of non-whitespace characters. Punctuation attached to a token
 *    belongs to it, and a line break or any other whitespace separates words.
 *    That is why an empty or whitespace-only document has zero words.
 * 2. The ceiling is inclusive. A document exactly at its limit is within
 *    budget and passes; the first word beyond it fails. The ceilings
 *    themselves are the checker's decision, not this module's.
 *
 * A document over budget is reported with the count that broke it and the
 * limit it broke, so the report can name both without re-measuring the file.
 */

/** One document and the word ceiling its caller holds it to. */
export interface BudgetDocument {
  /** Repository-relative path, as the report should name it. */
  path: string;
  text: string;
  /** The most words `text` may contain and still pass. */
  limit: number;
}

/** A document that has more words than its limit allows. */
export interface OverBudgetDocument {
  file: string;
  /** The document's word count, by the measure above. */
  words: number;
  /** The limit it exceeded, carried so the report can show both numbers. */
  limit: number;
}

/**
 * Every document in `documents` with more words than its own limit allows, in
 * the order they were handed in. An empty result means every document is
 * within budget.
 */
export function findOverBudgetDocuments(
  documents: readonly BudgetDocument[],
): OverBudgetDocument[] {
  const over: OverBudgetDocument[] = [];
  for (const document of documents) {
    const words = wordCount(document.text);
    if (words > document.limit) {
      over.push({ file: document.path, words, limit: document.limit });
    }
  }
  return over;
}

/** Whitespace-delimited tokens, which is what `wc -w` counts. */
function wordCount(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}
