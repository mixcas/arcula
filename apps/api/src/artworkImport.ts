// The artwork import's write core: a batch of loose rows in, how many landed
// and which posted rows were refused out.
//
// Two callers need exactly this write — the CSV route a member's review step
// posts to, and the agent surface's `import_artworks` tool — and a tool that
// replayed the route would be a second copy of the per-row contract to keep in
// step. So the route delegates here and the tool calls here, and the one
// behavioural decision the two share, the status every row lands with, has one
// home.
//
// Each row is parsed against the shared `artworkSchema` — the same schema the
// Add/Edit forms submit — and a failing row is reported by its index into the
// POSTED array plus its failed fields, so a caller can point at the row it
// sent without re-reading the file it came from. A row that is not an object
// fails as a missing title rather than as a malformed batch. The accepted rows
// are written in one transaction: the batch lands whole or not at all, while a
// row's own failure never withholds its neighbours.
//
// The batch's status is applied AFTER the row's fields, so the payload wins
// over anything a row carries. The route passes the payload's status or
// `IMPORTED_WORK_STATUS`; the agent tool passes `draft`, which is what makes a
// hallucinated row something the member deletes rather than a page the public
// reads.

import { artworks as artworksTable } from "@arcula/db";
import {
  UPDATABLE_TEXT_FIELDS,
  artworkSchema,
  type ArtworkImportOutcome,
  type ArtworkStatus,
} from "@arcula/shared";
import { memberCatalogueFor } from "./authorize";
import { safeTx } from "./http";
import { mintId } from "./ids";

/**
 * Import `rows` into the catalogue as this account, after the one membership
 * verdict (ADR-0004): the owner and every collaborator may add works, and an
 * account with no membership gets the app's own `forbidden`.
 *
 * The caller owns the status decision — the route's payload default and the
 * tool's `draft` are different answers to the same question — because a second
 * default here would be the one that silently wins.
 */
export async function importArtworks(
  userId: string,
  catalogueId: string,
  rows: readonly unknown[],
  status: ArtworkStatus,
): Promise<ArtworkImportOutcome> {
  const catalogue = await memberCatalogueFor(userId, catalogueId);

  const now = new Date();
  const rejected: ArtworkImportOutcome["rejected"] = [];
  const accepted: (typeof artworksTable.$inferInsert)[] = [];
  rows.forEach((row, index) => {
    // A row that is not an object fails the schema as a missing title.
    const fields =
      row !== null && typeof row === "object"
        ? (row as Record<string, unknown>)
        : {};
    // The batch's status is last, so it wins over a status the row names.
    const parsed = artworkSchema.safeParse({ ...fields, status });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        errors[issue.path.join(".")] = issue.message;
      }
      rejected.push({ row: index, errors });
      return;
    }
    const values = parsed.data;
    const inserted: typeof artworksTable.$inferInsert = {
      id: mintId(),
      // The mirror of the catalogue's owner: an import adds the catalogue's
      // works, whoever ran it (ADR-0004).
      userId: catalogue.userId,
      catalogueId: catalogue.id,
      title: values.title,
      artistName: values.artistName,
      status: values.status,
      // Always written, as null: the list filters on it, and a missing field
      // is not a null (the write-path doctrine).
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    for (const field of UPDATABLE_TEXT_FIELDS) {
      inserted[field] = values[field] ?? null;
    }
    accepted.push(inserted);
  });

  if (accepted.length > 0) {
    await safeTx(async (tx) => {
      for (const row of accepted) {
        await tx.insert(artworksTable).values(row);
      }
    });
  }

  return { inserted: accepted.length, rejected };
}
