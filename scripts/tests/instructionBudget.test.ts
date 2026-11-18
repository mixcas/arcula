import { describe, expect, it } from "vitest";
import {
  findOverBudgetDocuments,
  type BudgetDocument,
} from "../instructionBudget";

const document = (
  path: string,
  text: string,
  limit: number,
): BudgetDocument => ({
  path,
  text,
  limit,
});

describe("findOverBudgetDocuments", () => {
  it("passes a document exactly at its limit", () => {
    expect(
      findOverBudgetDocuments([document("AGENTS.md", "one two three", 3)]),
    ).toEqual([]);
  });

  it("reports a document one word over its limit with its exact count", () => {
    expect(
      findOverBudgetDocuments([
        document("apps/api/AGENTS.md", "one two three four", 3),
      ]),
    ).toEqual([{ file: "apps/api/AGENTS.md", words: 4, limit: 3 }]);
  });

  it("passes an empty document, which has no words at all", () => {
    expect(findOverBudgetDocuments([document("empty.md", "", 0)])).toEqual([]);
    expect(
      findOverBudgetDocuments([document("blank.md", " \n\t\n ", 0)]),
    ).toEqual([]);
  });

  it("reports only the documents over their own limit, in input order", () => {
    const over = findOverBudgetDocuments([
      document("AGENTS.md", "one two", 2),
      document("apps/web/AGENTS.md", "one two three four five", 4),
      document("packages/db/AGENTS.md", "one two three", 4),
      document("infra/cdk/AGENTS.md", "one two three four five six", 5),
    ]);

    expect(over).toEqual([
      { file: "apps/web/AGENTS.md", words: 5, limit: 4 },
      { file: "infra/cdk/AGENTS.md", words: 6, limit: 5 },
    ]);
  });

  it("counts a whitespace-separated token once, as wc -w does", () => {
    // `punctuation,` and `(parenthesised)` are single tokens, and the newline
    // separates `line` from `break.` — five words, not six.
    expect(
      findOverBudgetDocuments([
        document(
          "AGENTS.md",
          "punctuation, (parenthesised) `code`\nline break.",
          4,
        ),
      ]),
    ).toEqual([{ file: "AGENTS.md", words: 5, limit: 4 }]);
  });
});
