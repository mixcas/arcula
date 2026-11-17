// The `import_artworks` tool: a batch of rows an agent extracted from a
// document the member already has, landed in one Catalogue.
//
// The write itself is `artworkImport.ts`, the module the CSV route delegates
// to, so the per-row contract — parsed against the shared `artworkSchema`, a
// failing row reported by position and failed fields, the accepted rows in one
// transaction — is the app's, not a second copy.
//
// Two things are the tool's own, because they are about an agent rather than
// the web:
//
//   - **Drafts by default.** A person's CSV import lands published, which is
//     the route's default and unchanged. An agent extracting captions can
//     misread one, so the tool names `draft` unless the caller explicitly
//     says otherwise: a wrong row becomes something the member deletes, not a
//     page the public reads.
//   - **A 200-row batch cap.** The route has none — the review step has
//     already shown the person what it is about to write. The agent's schema
//     has one, because a silent half-written batch is worse than a second
//     call.
//
// An import is a write and spends the write allowance the dispatcher claims
// for every `write: true` tool, plus one of the hourly imports. The claim
// happens before the batch is parsed and written, exactly as the dispatcher
// spends the write before the tool runs: a refused call leaves no row behind.

import { z } from "zod";
import { artworkStatusSchema } from "@arcula/shared";
import { claimAgentImport } from "../../agentLimiter";
import { importArtworks } from "../../artworkImport";
import { defineTool } from "../tool";

/** The most rows one call accepts. */
const MAX_IMPORT_ROWS = 200;

const importArtworksInput = z.object({
  catalogueId: z.string().min(1, "A catalogue id is required"),
  rows: z
    .array(z.unknown())
    .max(
      MAX_IMPORT_ROWS,
      `At most ${MAX_IMPORT_ROWS} rows can be imported in one call; split a larger batch`,
    ),
  status: artworkStatusSchema.default("draft"),
});

export const importTools = [
  defineTool({
    name: "import_artworks",
    description:
      "Import a batch of works into one Catalogue and answer how many rows " +
      "landed (`inserted`) and which posted rows were refused (`rejected`, " +
      "each with its index in `rows` and the fields that failed). Use this " +
      "when the person already has the works in a document, spreadsheet or " +
      "list and wants them recorded. Every row lands as a Draft by default, " +
      "so a hallucinated artist or a misread caption is a row the member " +
      "deletes rather than a page the public reads; the member publishes " +
      'when satisfied. Pass `status: "published"` only when the person ' +
      "explicitly asks for the batch to go public now. A failing row does " +
      "not withhold the others: the accepted rows land in one transaction. " +
      "At most 200 rows per call — split a larger batch into calls of 200 or " +
      "fewer. The Catalogue must be one this account owns or collaborates " +
      "on; each import spends one of the account's hourly imports.",
    inputSchema: importArtworksInput,
    write: true,
    call: async ({ catalogueId, rows, status }, userId) => {
      // The dispatcher has spent the write for `write: true` already; this is
      // the import's own hourly allowance, spent before any row is written.
      await claimAgentImport(userId);
      return importArtworks(userId, catalogueId, rows, status);
    },
  }),
];
