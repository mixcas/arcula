// The Selection reads: the member list, the member document and the ordered
// works.
//
// The list is name-ordered and carries each row's live-work count, counted
// over the works a reader would actually see: a work deleted in its Catalogue
// is not counted, and a Draft is (a Selection shows Drafts on purpose). One
// grouped query for every row — the count is a fact about the page, not a
// reason to ask per Selection.
//
// The works read is the one list every audience gets: the manage page and the
// visitor page consume the same ordered envelope, and only the serializer's
// audience decides what a Draft or a document looks like on it. There is no
// status filter — a Draft is the point — and a work deleted in its Catalogue
// simply leaves, without its curation row being removed, so a restore rejoins
// it.
//
// No Hono type lives here: the route owns the envelope and the status codes.

import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import {
  artworks as artworksTable,
  selectionWorks as selectionWorksTable,
  selections as selectionsTable,
} from "@arcula/db";
import type {
  ArtworkRead,
  SelectionPageRow,
  SelectionPublicRead,
  SelectionRead,
} from "@arcula/shared";
import type { CatalogueAudience } from "./access";
import { groupChildren, loadChildren, noChildren } from "./artworkRead";
import type { ArtworkRow, CatalogueRow, SelectionRow } from "./authorize";
import { db } from "./db";
import { ApiError } from "./errors";
import { mediaNamespaceOf } from "./media/keys";
import { isSkinOptions, serializeArtwork, wireTimestamp } from "./serialize";

/**
 * The exact member wire document.
 *
 * Blank text is an absent key, never `null`. `isPasswordProtected` is derived
 * from the hash's presence — the hash itself never leaves the server — and is
 * a member fact only; `readPublicSelection` below deliberately omits it.
 */
export function readSelection(row: SelectionRow): SelectionRead {
  const out: SelectionRead = {
    id: row.id,
    catalogueId: row.catalogueId,
    name: row.name,
    isPublic: row.isPublic,
    createdAt: wireTimestamp(row.createdAt),
    updatedAt: wireTimestamp(row.updatedAt),
    isPasswordProtected: row.passwordHash !== null,
  };
  if (row.description !== null) out.description = row.description;
  return out;
}

/**
 * The exact public wire document: the Selection, its source Catalogue's name,
 * and the presentation it inherits.
 *
 * The document is deliberately smaller than the member read. There is no
 * `catalogueId`, no slug and no address of the source Catalogue: its page is a
 * different gate, often a private one, and a link to it would send a visitor to
 * a lock screen or a 404. The name is a credit, not a route.
 *
 * `skin` and `skinOptions` are the Catalogue's stored values, passed raw. The
 * web resolves them through the same registry it uses for a Catalogue, so the
 * API never has to know what a skin declares — and a Selection renders in the
 * Catalogue's presentation without a schema of its own.
 */
export function readPublicSelection(
  selection: SelectionRow,
  catalogue: CatalogueRow,
): SelectionPublicRead {
  const document: SelectionPublicRead["selection"] = {
    id: selection.id,
    name: selection.name,
    isPublic: selection.isPublic,
  };
  if (selection.description !== null) {
    document.description = selection.description;
  }
  const out: SelectionPublicRead = {
    selection: document,
    catalogueName: catalogue.name,
  };
  if (catalogue.skin !== null) {
    out.skin = catalogue.skin;
  }
  if (catalogue.skinOptions !== null) {
    if (!isSkinOptions(catalogue.skinOptions)) {
      throw new ApiError("internal", "Malformed catalogue skin options");
    }
    out.skinOptions = catalogue.skinOptions;
  }
  return out;
}

/**
 * A Catalogue's live Selections, name-ordered, each with its live-work count.
 *
 * Counts are read in one grouped query keyed by the live Selection ids the
 * list already loaded. A Selection with no rows is absent from the group and
 * counts zero; a deleted work is excluded by the join's own condition, so a
 * Selection whose works were all deleted reads as empty rather than stale.
 */
export async function readSelectionPage(
  catalogueId: string,
): Promise<SelectionPageRow[]> {
  const rows = await db
    .select()
    .from(selectionsTable)
    .where(
      and(
        eq(selectionsTable.catalogueId, catalogueId),
        isNull(selectionsTable.deletedAt),
      ),
    )
    .orderBy(asc(selectionsTable.name), asc(selectionsTable.id));

  if (rows.length === 0) return [];

  const counts = await db
    .select({
      selectionId: selectionWorksTable.selectionId,
      total: count(),
    })
    .from(selectionWorksTable)
    .innerJoin(
      artworksTable,
      eq(artworksTable.id, selectionWorksTable.artworkId),
    )
    .where(
      and(
        inArray(
          selectionWorksTable.selectionId,
          rows.map((row) => row.id),
        ),
        isNull(artworksTable.deletedAt),
      ),
    )
    .groupBy(selectionWorksTable.selectionId);

  const counted = new Map(counts.map((row) => [row.selectionId, row.total]));
  return rows.map((row) => ({
    ...readSelection(row),
    workCount: counted.get(row.id) ?? 0,
  }));
}

/**
 * A Selection's works, in the curator's order, as the viewer's audience sees
 * them — the one ordered read both the manage page and the visitor page use.
 *
 * Ordering is `position`, then `artworkId` so a row that ever carried a
 * duplicated position still sorts deterministically: every write renumbers, and
 * this is the answer if one ever did not. Live works only — `deletedAt IS NULL`
 * — and **no status filter**: a Draft is shown here on purpose, and the media
 * scope on the photo URLs is what lets its images load.
 *
 * Children come from `artworkRead.ts`'s batched loader, so this is the same
 * three queries the Catalogue's list uses rather than a second child path, and
 * every work is serialized by the one serializer. `selectionId` rides the photo
 * URLs only.
 *
 * A visitor is not shown that a work has documents at all: the bytes were
 * never theirs, and a certificate's existence is a member fact. The array is
 * emptied rather than the key omitted, because the read's document shape is
 * the same one every works read answers.
 */
export async function readSelectionWorks(
  selectionId: string,
  catalogue: CatalogueRow,
  audience: CatalogueAudience,
): Promise<ArtworkRead[]> {
  const rows = await db
    .select({ artwork: artworksTable })
    .from(selectionWorksTable)
    .innerJoin(
      artworksTable,
      eq(artworksTable.id, selectionWorksTable.artworkId),
    )
    .where(
      and(
        eq(selectionWorksTable.selectionId, selectionId),
        isNull(artworksTable.deletedAt),
      ),
    )
    .orderBy(asc(selectionWorksTable.position), asc(artworksTable.id));
  return serializeWorks(
    rows.map((row) => row.artwork),
    selectionId,
    catalogue,
    audience,
  );
}

/**
 * One curated work at the Selection's own artwork address, or `null` when it
 * is not there — a work outside the Selection, a work deleted in its Catalogue,
 * and a work from another Catalogue are the same absence.
 *
 * It shares the list's children loader and serializer rather than opening a
 * second path: the same batched photo/document queries, the same audience rule,
 * and the same `{ selectionId }` scope on the photo URLs. The curation row is
 * the membership proof, and `deletedAt IS NULL` is the liveness rule the row
 * alone does not carry (a deleted work keeps its row so a restore rejoins).
 */
export async function readSelectionArtwork(
  selectionId: string,
  catalogue: CatalogueRow,
  artworkId: string,
  audience: CatalogueAudience,
): Promise<ArtworkRead | null> {
  const row = (
    await db
      .select({ artwork: artworksTable })
      .from(selectionWorksTable)
      .innerJoin(
        artworksTable,
        eq(artworksTable.id, selectionWorksTable.artworkId),
      )
      .where(
        and(
          eq(selectionWorksTable.selectionId, selectionId),
          eq(selectionWorksTable.artworkId, artworkId),
          eq(artworksTable.catalogueId, catalogue.id),
          isNull(artworksTable.deletedAt),
        ),
      )
  )[0];
  if (!row) return null;
  const [document] = await serializeWorks(
    [row.artwork],
    selectionId,
    catalogue,
    audience,
  );
  return document ?? null;
}

/**
 * The one place a curated work becomes a wire document: the batched children
 * loader, the source Catalogue's media namespace (a Selection owns no bytes)
 * and the serializer with the Selection's photo scope.
 *
 * A visitor is not shown that a work has documents at all — the bytes were
 * never theirs, and a certificate's existence is a member fact. The array is
 * emptied rather than the key omitted, because every works read answers the
 * same document shape.
 */
async function serializeWorks(
  artworks: ArtworkRow[],
  selectionId: string,
  catalogue: CatalogueRow,
  audience: CatalogueAudience,
): Promise<ArtworkRead[]> {
  if (artworks.length === 0) return [];

  const artworkIds = artworks.map((artwork) => artwork.id);
  const grouped = groupChildren(artworkIds, await loadChildren(artworkIds));
  const namespaceId = mediaNamespaceOf(catalogue);
  return artworks.map((artwork) => {
    const document = serializeArtwork(
      { artwork, ...(grouped.get(artwork.id) ?? noChildren()) },
      namespaceId,
      audience,
      { selectionId },
    );
    return audience === "member" ? document : { ...document, documents: [] };
  });
}
