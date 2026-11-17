// The single read path for Artworks, single and listed.
//
// One module owns reading works: the Catalogue, the works, their photos,
// their documents and their Variants — at most five queries for an owner or
// a non-member (a collaborator's membership row is one more), whatever the
// number of works. The child loader takes a set of Artwork ids, so a page of
// works batches through the same loader the single read uses instead of
// growing a second one.
//
// The access verdict is the pure rule in access.ts over the rows loaded here
// — the Catalogue, the work and the viewer's membership row, loaded by
// `authorize.ts`, plus the Access grant's validity, read off the request's
// cookie by the route and handed in as a fact (a Protected Catalogue admits a
// non-member only through it, ADR-0005). This module reports `not-found`,
// `unauthorized` or `forbidden` and carries no HTTP code or framework type.
// The route owns the wire codes. Only a list can answer `forbidden` — a
// Private Catalogue the viewer is not a member of, a Protected one the
// visitor holds no grant for, or the Deleted list asked for by a non-member —
// because that is the list's existing wire, and the Catalogue read answers
// the same refusal so the two reads agree about who is inside; a single read
// answers `not-found` for every refusal (a Private Catalogue included) so the
// refusal discloses nothing.
//
// Each document is serialized for the viewer's audience: a member read
// carries a work's `availability`, a visitor's does not. It is a member-facing
// market fact and never a gate, so a visitor still sees a published work that
// happens to be sold.
//
// No transaction spans the reads: a work or child added or removed between
// them is a torn read the product tolerates, and no caller may assume a
// snapshot. Ordering is part of the document: the live list is creation time
// and then id, the Deleted list is deletion time (newest first) and then id,
// photos are in `order`, documents by id, and the serializer groups Variants
// by parent.
//
// The live list takes an optional **Catalogue search**: a present query is a
// member-only condition checked ahead of the visitor verdict (a grant holder is
// refused it even on a Protected catalogue), and the matching works are
// selected here over the rows the list already read — no SQL pushdown, no
// second read and no schema change. Deleted works are never candidates and a
// member's drafts are; only the works that survive both the verdict and the
// predicate load their photos and documents. The predicate itself is
// `@arcula/shared`'s, so the API and the client share one field list and one
// normalization; the Catalogue row the list already loaded decides which of
// its fields contribute, so a field it does not record is not found.
//
// The save routes read their own work back through `readArtwork`, so a save
// answers exactly what a read of the same work would.

import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  artworks as artworksTable,
  artworkDocuments as artworkDocumentsTable,
  artworkPhotoVariants as artworkPhotoVariantsTable,
  artworkPhotos as artworkPhotosTable,
} from "@arcula/db";
import {
  MAX_SEARCH_QUERY_LENGTH,
  MAX_SEARCH_TERMS,
  artworkFacets,
  compareArtworksForList,
  matchesArtworkFilters,
  matchesArtworkSearch,
  parseArtworkSearchQuery,
  resolveArtworkFields,
  searchQueryOverflow,
  type ArtworkFacets,
  type ArtworkRead,
  type ArtworkSearchProblem,
  type ArtworkSearchQueryParse,
  type SearchQueryOverflow,
} from "@arcula/shared";
import { audienceOf, canSeeArtwork, canSeeCatalogue, isMember } from "./access";
import {
  loadArtworkInCatalogue,
  loadCatalogue,
  loadMembership,
} from "./authorize";
import { db } from "./db";
import { mediaNamespaceOf } from "./media/keys";
import { serializeArtwork, type ArtworkJoined } from "./serialize";

/** What a single read answers: the document, or one uniform refusal. */
export type ArtworkReadResult =
  | { readonly status: "ok"; readonly artwork: ArtworkRead }
  | { readonly status: "not-found" };

/**
 * What a list read answers: a page of visible works plus the facts that
 * describe it, or the one refusal the list can make. A missing Catalogue is
 * `not-found`; a Private Catalogue the viewer does not own is `forbidden`.
 * `unauthorized` is the search's own refusal: the member-only live list asked
 * for by a caller with no session. `invalid-search` is a query that cannot be
 * answered — the free text past its caps, or a structured query naming an
 * unknown field, a bad enumerated value, an offset without a limit, or too
 * many values — checked after the access questions, so a missing catalogue,
 * an anonymous caller or a non-member is refused for that reason rather than
 * for their query.
 *
 * `total` is the number of matches before paging; `limit` is null when the
 * request asked for none, which is every match; `facets` is present only when
 * the request named fields. Both are counted over the filtered set.
 */
export type ArtworkListResult =
  | {
      readonly status: "ok";
      readonly artworks: ArtworkRead[];
      readonly total: number;
      readonly limit: number | null;
      readonly offset: number;
      readonly facets?: ArtworkFacets;
    }
  | { readonly status: "forbidden" }
  | { readonly status: "unauthorized" }
  | { readonly status: "not-found" }
  | {
      readonly status: "invalid-search";
      readonly problem: ArtworkSearchProblem;
    };

type ArtworkChildren = Pick<ArtworkJoined, "photos" | "documents" | "variants">;

/** An Artwork's no children: a work with nothing attached to it. */
const noChildren = (): ArtworkChildren => ({
  photos: [],
  documents: [],
  variants: [],
});

/**
 * The children of every Artwork in `artworkIds`: one photos query, one
 * documents query and one Variants query, whatever the size of the set.
 */
async function loadChildren(
  artworkIds: readonly string[],
): Promise<ArtworkChildren> {
  if (artworkIds.length === 0) return noChildren();
  const photos = await db
    .select()
    .from(artworkPhotosTable)
    .where(inArray(artworkPhotosTable.artworkId, [...artworkIds]))
    .orderBy(asc(artworkPhotosTable.order));
  const documents = await db
    .select()
    .from(artworkDocumentsTable)
    .where(inArray(artworkDocumentsTable.artworkId, [...artworkIds]))
    .orderBy(asc(artworkDocumentsTable.id));
  const parentIds = [...photos.map((p) => p.id), ...documents.map((d) => d.id)];
  const variants =
    parentIds.length > 0
      ? await db
          .select()
          .from(artworkPhotoVariantsTable)
          .where(inArray(artworkPhotoVariantsTable.parentId, parentIds))
      : [];
  return { photos, documents, variants };
}

/**
 * The flat child rows split per Artwork, in one pass. Variants hang off a
 * photo or a document, so the parent map assigns them to the work that owns
 * their parent.
 */
function groupChildren(
  artworkIds: readonly string[],
  children: ArtworkChildren,
): Map<string, ArtworkChildren> {
  const grouped = new Map<string, ArtworkChildren>();
  const artworkOfParent = new Map<string, string>();
  for (const artworkId of artworkIds) {
    grouped.set(artworkId, noChildren());
  }
  for (const photo of children.photos) {
    const bucket = grouped.get(photo.artworkId);
    if (!bucket) continue;
    bucket.photos.push(photo);
    artworkOfParent.set(photo.id, photo.artworkId);
  }
  for (const document of children.documents) {
    const bucket = grouped.get(document.artworkId);
    if (!bucket) continue;
    bucket.documents.push(document);
    artworkOfParent.set(document.id, document.artworkId);
  }
  for (const variant of children.variants) {
    const artworkId = artworkOfParent.get(variant.parentId);
    if (artworkId === undefined) continue;
    grouped.get(artworkId)?.variants.push(variant);
  }
  return grouped;
}

/**
 * One Artwork as its Viewer sees it, or `not-found`.
 *
 * A missing Catalogue, a missing work, a Draft, a Deleted work, a work
 * behind a Private Catalogue and a work under the wrong Catalogue are one
 * answer for anyone but a member: saying which was refused would be a
 * disclosure. A member — the Owner or any Collaborator — reads every work of
 * the catalogue, deleted ones included.
 *
 * The Catalogue, the work and the three child reads run without a
 * transaction: a row added or removed between them is a torn read the
 * product tolerates, and no caller may treat the document as a snapshot.
 */
export async function readArtwork(
  catalogueId: string,
  artworkId: string,
  viewer: string | null,
  hasValidGrant = false,
): Promise<ArtworkReadResult> {
  const catalogue = await loadCatalogue(catalogueId);
  if (!catalogue) return { status: "not-found" };
  const artwork = await loadArtworkInCatalogue(catalogueId, artworkId);
  if (!artwork) return { status: "not-found" };
  const membership = await loadMembership(catalogueId, catalogue, viewer);
  if (!canSeeArtwork(membership, catalogue, artwork, hasValidGrant)) {
    return { status: "not-found" };
  }
  const children = await loadChildren([artworkId]);
  return {
    status: "ok",
    artwork: serializeArtwork(
      { artwork, ...children },
      mediaNamespaceOf(catalogue),
      audienceOf(membership),
    ),
  };
}

/**
 * Which side of the deletion stamp a list read is about. The two are separate
 * reads of the same module, not one route with a query flag: a visitor may
 * never ask for the Deleted side at all (ADR-0004), and the live list is the
 * only one the public pages touch.
 */
type ArtworkListMode = "live" | "deleted";

/**
 * A Catalogue's Artwork list as its Viewer sees it, on one side of the
 * deletion stamp.
 *
 * The live list keeps the two filters it has always used: a member gets every
 * live work of the catalogue — no `userId` filter, because every member reads
 * the same list — and a non-member only Published, live works; a Deleted work
 * is in neither. The Deleted list is member-only, even on a Public Catalogue,
 * and holds only works with a deletion stamp: membership is the whole gate, so
 * a non-member is `forbidden` rather than an empty list.
 *
 * A Private Catalogue the viewer is not a member of, or a Protected one they
 * hold no grant for, is `forbidden` (never `not-found` — the client maps it to
 * "private"), and a missing Catalogue is `not-found`.
 *
 * A present `search` is the live list's member-only condition, checked before
 * the visitor verdict: no session is `unauthorized`, a signed-in non-member
 * (grant holder included) is `forbidden`. The predicate then filters the rows
 * that survived the verdict, so a search can never widen what the viewer may
 * see; only the surviving works load their children.
 *
 * The live rows take the structured query's order — `updated` by default,
 * newest first, always ending on id — and its page; the Deleted list keeps
 * deletion time, newest first, and answers every row. Children arrive from the
 * same three batched queries as the single read, and the verdict still runs
 * over each loaded row, so each list fails closed if its filter and the rule
 * ever disagree.
 */
async function readArtworkListInMode(
  catalogueId: string,
  viewer: string | null,
  mode: ArtworkListMode,
  hasValidGrant = false,
  search: string | null = null,
  structured: ArtworkSearchQueryParse = parseArtworkSearchQuery({}),
): Promise<ArtworkListResult> {
  const catalogue = await loadCatalogue(catalogueId);
  if (!catalogue) return { status: "not-found" };
  const member = await loadMembership(catalogueId, catalogue, viewer);

  if (mode === "deleted") {
    // Membership alone: a public catalogue's deleted works are still the
    // members' business, and a grant is not an invitation to them.
    if (!isMember(member)) return { status: "forbidden" };
  } else if (search !== null) {
    // The member-only condition first, so a grant holder is refused it even
    // on a Protected catalogue rather than being challenged for a password.
    if (viewer === null) return { status: "unauthorized" };
    if (!isMember(member)) return { status: "forbidden" };
  } else if (!canSeeCatalogue(member, catalogue, hasValidGrant)) {
    return { status: "forbidden" };
  }

  // The caps are the query's own validity, so they are answered after the
  // access questions: who may ask comes before what they asked. No rows load
  // for a query that cannot be searched. The free text answers first, then
  // the structured query — both are the caller's own arguments.
  if (search !== null) {
    const overflow = searchQueryOverflow(search);
    if (overflow !== null) {
      return { status: "invalid-search", problem: overflowProblem(overflow) };
    }
  }
  if (structured.status === "invalid") {
    return { status: "invalid-search", problem: structured.problem };
  }
  const query = structured.query;

  const rows = await db
    .select()
    .from(artworksTable)
    .where(
      mode === "deleted"
        ? and(
            eq(artworksTable.catalogueId, catalogueId),
            isNotNull(artworksTable.deletedAt),
          )
        : member !== null
          ? and(
              eq(artworksTable.catalogueId, catalogueId),
              isNull(artworksTable.deletedAt),
            )
          : and(
              eq(artworksTable.catalogueId, catalogueId),
              eq(artworksTable.status, "published"),
              isNull(artworksTable.deletedAt),
            ),
    )
    .orderBy(
      mode === "deleted"
        ? desc(artworksTable.deletedAt)
        : asc(artworksTable.createdAt),
      asc(artworksTable.id),
    );

  const visible = rows.filter((row) =>
    canSeeArtwork(member, catalogue, row, hasValidGrant),
  );
  // The search runs after the verdict: it narrows what the viewer may see and
  // can never add to it. The Catalogue's own fields decide the haystack and
  // the filters: a field it does not record contributes no text and cannot
  // match, so a search never finds what the form and the PDF do not show. A
  // committed query with no terms matches nothing, and the structured filters
  // AND with it. `total` and the facets are counted over the filtered set,
  // before a page is cut.
  const enabled = resolveArtworkFields(
    catalogue.kind,
    catalogue.artworkFields,
  ).enabled;
  const works = visible.filter(
    (row) =>
      (search === null || matchesArtworkSearch(row, search, enabled)) &&
      matchesArtworkFilters(row, query.filters, enabled),
  );
  // The structured order and page are the live list's: the Deleted view keeps
  // its own deletion-time order and answers every row, so it takes neither.
  const ordered =
    mode === "live"
      ? [...works].sort((a, b) => compareArtworksForList(a, b, query.sort))
      : works;
  const page =
    mode === "live" && query.limit !== null
      ? ordered.slice(query.offset, query.offset + query.limit)
      : ordered.slice(mode === "live" ? query.offset : 0);
  const artworkIds = page.map((work) => work.id);
  const grouped = groupChildren(artworkIds, await loadChildren(artworkIds));
  return {
    status: "ok",
    artworks: page.map((work) =>
      serializeArtwork(
        {
          artwork: work,
          ...(grouped.get(work.id) ?? noChildren()),
        },
        mediaNamespaceOf(catalogue),
        audienceOf(member),
      ),
    ),
    total: works.length,
    limit: query.limit,
    offset: query.offset,
    ...(query.facets.length === 0
      ? {}
      : { facets: artworkFacets(works, query.facets, enabled) }),
  };
}

/** The free-text search's cap, as the problem the route answers with. */
function overflowProblem(overflow: SearchQueryOverflow): ArtworkSearchProblem {
  return {
    field: "q",
    message:
      overflow === "too-long"
        ? `Search is limited to ${MAX_SEARCH_QUERY_LENGTH} characters`
        : `Search is limited to ${MAX_SEARCH_TERMS} words`,
  };
}

/**
 * The live list: a member's every live work, a visitor's published ones.
 * A present `search` is member-only and ANDs with the structured query; the
 * structured filters, order, page and facets are the caller's own request and
 * are answered within the same verdict.
 */
export function readArtworkList(
  catalogueId: string,
  viewer: string | null,
  hasValidGrant = false,
  search: string | null = null,
  structured: ArtworkSearchQueryParse = parseArtworkSearchQuery({}),
): Promise<ArtworkListResult> {
  return readArtworkListInMode(
    catalogueId,
    viewer,
    "live",
    hasValidGrant,
    search,
    structured,
  );
}

/**
 * The Deleted view's answer: the same read with two arms removed. It takes no
 * search, so an invalid query cannot occur, and it sits behind a session, so
 * there is no `unauthorized` arm to map.
 */
export type DeletedArtworkListResult = Extract<
  ArtworkListResult,
  { readonly status: "ok" | "forbidden" | "not-found" }
>;

/**
 * The Deleted view's list: every work of the catalogue that carries a
 * deletion stamp, most recently deleted first. Member-only (ADR-0004) — the
 * owner and every collaborator see the same list, and nobody else sees one.
 */
export function readDeletedArtworkList(
  catalogueId: string,
  viewer: string | null,
): Promise<DeletedArtworkListResult> {
  // The cast states what the call site already guarantees: no search, and a
  // caller the deleted route has resolved a session for.
  return readArtworkListInMode(
    catalogueId,
    viewer,
    "deleted",
  ) as Promise<DeletedArtworkListResult>;
}
