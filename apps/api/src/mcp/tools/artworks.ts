// The artwork tools: the reads a Connection starts from — `search_artworks`
// and `get_artwork` — and the writes that let an agent add and shape a work.
//
// Both reads call `artworkRead.ts` and both writes call `artworkWrite.ts`,
// the modules the routes call, so there is one authorization verdict and one
// place where "a visitor sees published works only" is true — a tool that
// read the rows itself would be a second verdict to keep in step. The
// structured query is `@arcula/shared`'s, the same parse, predicates, order
// and facets the list route runs; this file only maps tool arguments onto the
// raw parameter bag the parser expects and maps its answers back.
//
// Two things are the search tool's own, because they are about an agent
// rather than the web:
//
//   - **A page by default.** An agent pays for every row it receives, so the
//     tool names a limit of 50 when the caller names none. The route's "no
//     limit means every match" is the web's behaviour and stays the route's.
//   - **Summaries, not documents.** A search row carries the eight facts a
//     decision needs and none of the record's media. `get_artwork` is how a
//     caller asks for the full record.
//
// The write schemas are the shared save schemas minus the media and the
// client-minted id: the agent records the Add form's fields and the API mints
// the id. Their descriptions carry the one rule a schema cannot — a Collection
// records an Availability and never shows it.

import { z } from "zod";
import {
  ARTWORK_FIELD_KEYS,
  artworkCreateSchema,
  artworkUpdateSchema,
  parseArtworkSearchQuery,
  resolveArtworkFields,
  type ArtworkFieldStates,
  type ArtworkRead,
  type ArtworkSearchProblem,
} from "@arcula/shared";
import { readArtwork, readArtworkList } from "../../artworkRead";
import { createArtworkFor, updateArtworkFor } from "../../artworkWrite";
import { loadCatalogue } from "../../authorize";
import { ApiError } from "../../errors";
import { defineTool } from "../tool";

/**
 * The page the tool answers when the caller names none. Smaller than the
 * route's 100 cap on purpose: a summary is cheap for us and expensive for the
 * agent's context, and 50 works is a readable list.
 */
const DEFAULT_SEARCH_LIMIT = 50;

const searchArtworksInput = z.object({
  catalogueId: z.string().min(1),
  /** Field → values. Deliberately open: `parseArtworkSearchQuery` owns the
   *  field list, the caps and the enum values, so an unknown field or a bad
   *  value is the parser's validation error, not a second schema. */
  filters: z.record(z.string(), z.array(z.string())).optional(),
  sort: z.string().optional(),
  limit: z.number().int().min(0).optional(),
  offset: z.number().int().min(0).optional(),
  facets: z.array(z.string()).optional(),
});

type SearchArtworkArgs = z.output<typeof searchArtworksInput>;

/**
 * The tool's arguments as the raw query strings the route's parser reads: a
 * filter field keeps its values as the set that ORs, `sort` and `facets` become
 * single-value lists, and the page is always named — 50 unless the caller said
 * otherwise — so an offset never arrives without a limit.
 */
function searchParams(
  args: SearchArtworkArgs,
): Record<string, readonly string[]> {
  const params: Record<string, readonly string[]> = {};
  for (const [field, values] of Object.entries(args.filters ?? {})) {
    params[field] = values;
  }
  if (args.sort !== undefined) params.sort = [args.sort];
  params.limit = [String(args.limit ?? DEFAULT_SEARCH_LIMIT)];
  if (args.offset !== undefined) params.offset = [String(args.offset)];
  if (args.facets !== undefined) params.facets = args.facets;
  return params;
}

/** The parser's and the read's one invalid-query answer: the envelope's
 *  `validation` code, the parser's own message, and the field that carries
 *  the problem — what an agent needs to fix the call. */
const invalidSearch = (problem: ArtworkSearchProblem): ApiError =>
  new ApiError("validation", problem.message, {
    fields: { [problem.field]: problem.message },
  });

/**
 * What the Catalogue records, resolved from the row the read already loaded.
 * A missing Catalogue answers `null`; the caller has already refused the read
 * in that case, so this only guards against a deletion between the two reads.
 */
async function enabledFieldsOf(
  catalogueId: string,
): Promise<ArtworkFieldStates | null> {
  const catalogue = await loadCatalogue(catalogueId);
  return catalogue
    ? resolveArtworkFields(catalogue.kind, catalogue.artworkFields).enabled
    : null;
}

/**
 * The record an agent may see: a field the Catalogue does not record is
 * absent, never `null`. The row may still hold a value from before the field
 * was switched off — the app's forms hide it, and the agent surface hides it
 * too, so a search and a read agree with the settings.
 */
function recordedFields(
  artwork: ArtworkRead,
  enabled: ArtworkFieldStates,
): Record<string, unknown> {
  const view: Record<string, unknown> = { ...artwork };
  for (const field of ARTWORK_FIELD_KEYS) {
    if (!enabled[field]) delete view[field];
  }
  return view;
}

/**
 * One work as a search row names it: identity, status, the market state, the
 * medium and the two dates — never photos, documents or variants. The three
 * record fields a summary carries are filtered by the Catalogue's settings, so
 * a disabled field never reaches the agent in a page either.
 *
 * The absent keys follow the wire document's rules rather than inventing
 * values: `availability` is the member's fact (a visitor's work has no key at
 * all) and a blank text field is absent, so a summary reads like the document
 * it summarizes.
 */
const workSummary = (work: ArtworkRead, enabled: ArtworkFieldStates) => ({
  id: work.id,
  title: work.title,
  artistName: work.artistName,
  status: work.status,
  ...(enabled.availability && work.availability !== undefined
    ? { availability: work.availability }
    : {}),
  ...(enabled.medium && work.medium !== undefined
    ? { medium: work.medium }
    : {}),
  ...(enabled.dateOfCreation && work.dateOfCreation !== undefined
    ? { dateOfCreation: work.dateOfCreation }
    : {}),
  updatedAt: work.updatedAt,
});

const getArtworkInput = z.object({
  catalogueId: z.string().min(1),
  artworkId: z.string().min(1),
});

/**
 * The create arguments: the Add form's whole field set, without the save's
 * staged media or its client-minted id — an agent sends no bytes, and the API
 * mints the id. The shared schema keeps `title` required and defaults
 * `status` to published, so the tool does not restate either.
 */
const createArtworkInput = artworkCreateSchema
  .omit({ artworkId: true, photos: true, documents: true })
  .extend({ catalogueId: z.string().min(1, "A catalogue id is required") });

/**
 * The update arguments: the writable fields, every one optional, plus the two
 * ids. A call names what changes; `z.object` strips an unknown key, and the
 * core writes only the keys it finds.
 */
const updateArtworkInput = z
  .object({
    catalogueId: z.string().min(1, "A catalogue id is required"),
    artworkId: z.string().min(1, "An artwork id is required"),
  })
  .extend(
    artworkUpdateSchema.omit({ photos: true, documents: true }).partial().shape,
  );

export const artworkTools = [
  defineTool({
    name: "search_artworks",
    description:
      "Search one Catalogue's works and answer a page of summaries — id, " +
      "title, artist, status, availability, medium, creation date and when " +
      "the work was last updated — with the whole match count and any facets " +
      "asked for. `total` is the match count before paging. `filters` is an " +
      "object whose values are arrays: the text fields title, artistName, " +
      "serie, medium, editions, dateOfCreation, acquisitionDate, " +
      "placeOfOrigin, provenance and notes, plus status (published or draft) " +
      "and availability (available, reserved, sold, on-consignment). Values " +
      "repeated within one field mean either; different fields mean all. " +
      "Text matches ignore case and accents and must appear in that field; " +
      "status and availability must be exact. `sort` is updated (newest " +
      "first, the default), title, artistName or dateOfCreation. `limit` " +
      "defaults to 50 and is at most 100; `offset` pages through the result. " +
      "`facets` names filterable fields and answers their values with counts " +
      "over the filtered set. A member sees drafts; anyone else sees " +
      "published works of a public Catalogue only. A summary never carries " +
      "photos, documents or variants — use get_artwork for the full record.",
    inputSchema: searchArtworksInput,
    call: async (args, userId) => {
      const read = await readArtworkList(
        args.catalogueId,
        userId,
        false,
        null,
        parseArtworkSearchQuery(searchParams(args)),
      );
      if (read.status === "not-found") {
        throw new ApiError("not-found", "The catalogue does not exist");
      }
      if (read.status === "unauthorized") {
        throw new ApiError("unauthorized", "Sign in to search this catalogue");
      }
      if (read.status === "forbidden") {
        throw new ApiError(
          "forbidden",
          "You do not have access to this catalogue",
        );
      }
      if (read.status === "invalid-search") {
        throw invalidSearch(read.problem);
      }
      const enabled = await enabledFieldsOf(args.catalogueId);
      if (enabled === null) {
        throw new ApiError("not-found", "The catalogue does not exist");
      }
      return {
        total: read.total,
        limit: read.limit,
        offset: read.offset,
        artworks: read.artworks.map((work) => workSummary(work, enabled)),
        ...(read.facets === undefined ? {} : { facets: read.facets }),
      };
    },
  }),

  defineTool({
    name: "get_artwork",
    description:
      "Read one work in full: every recorded field plus its photos, documents " +
      "and Variants. A draft and a work in a private Catalogue answer " +
      "`not-found` to an account that is not a member, exactly as the app " +
      "refuses them; a member reads every live work, and a deleted work " +
      "answers `not-found` to everyone. Use search_artworks to find a work's id.",
    inputSchema: getArtworkInput,
    call: async ({ catalogueId, artworkId }, userId) => {
      const read = await readArtwork(catalogueId, artworkId, userId, false);
      // One uniform not-found: which refusal it was would be a disclosure. The
      // app's Deleted view is a member read of a deleted row, but an agent's
      // answer never carries one, so a deleted stamp is the same not-found.
      if (read.status !== "ok" || read.artwork.deletedAt != null) {
        throw new ApiError("not-found", "The artwork does not exist");
      }
      const enabled = await enabledFieldsOf(catalogueId);
      if (enabled === null) {
        throw new ApiError("not-found", "The artwork does not exist");
      }
      return recordedFields(read.artwork, enabled);
    },
  }),

  defineTool({
    name: "create_artwork",
    description:
      "Create an Artwork in a Catalogue and answer it as written. `title` and " +
      "`artistName` are required; the rest of the Add form's fields are " +
      "optional — serie, dateOfCreation, medium, dimensions, editions, " +
      "acquisitionDate, acquisitionPrice, placeOfOrigin, provenance, notes, " +
      "condition, currentValue and status (published or draft; published " +
      "unless named). Every Catalogue records a chosen set of fields: a save that " +
      "names one the Catalogue does not record is refused with " +
      "`field-disabled`. Availability is one of those fields — on by default " +
      "for a Portfolio or an Inventory, off by default for a Collection, and " +
      "either way a choice the member can change. Any member — the Owner or " +
      "a Collaborator — may create " +
      "works; a non-member is refused. Use search_artworks to read a " +
      "Catalogue's works. Photos and documents are uploaded in the app, not " +
      "here.",
    inputSchema: createArtworkInput,
    write: true,
    call: async ({ catalogueId, ...fields }, userId) => {
      const created = await createArtworkFor(userId, catalogueId, fields);
      const enabled = await enabledFieldsOf(catalogueId);
      if (enabled === null) {
        throw new ApiError("not-found", "The catalogue does not exist");
      }
      return recordedFields(created, enabled);
    },
  }),

  defineTool({
    name: "update_artwork",
    description:
      "Change the fields a call names on one Artwork and answer the work as " +
      "written. Every field is optional and only the fields sent change — " +
      "title, artistName, serie, dateOfCreation, medium, dimensions, " +
      "editions, acquisitionDate, acquisitionPrice, placeOfOrigin, " +
      "provenance, notes, condition, currentValue, status and availability. " +
      "A text field sent as `null` clears it. Every Catalogue records a chosen " +
      "set of fields: naming one it does not record is refused with " +
      "`field-disabled`. Availability is one of those fields — on by default " +
      "for a Portfolio or an Inventory, off by default for a Collection. Any " +
      "member may write; a missing or invisible Artwork answers `not-found`. " +
      "Use search_artworks to find an Artwork's id.",
    inputSchema: updateArtworkInput,
    write: true,
    call: async ({ catalogueId, artworkId, ...fields }, userId) => {
      const written = await updateArtworkFor(
        userId,
        catalogueId,
        artworkId,
        fields,
      );
      const enabled = await enabledFieldsOf(catalogueId);
      if (enabled === null) {
        throw new ApiError("not-found", "The artwork does not exist");
      }
      return recordedFields(written, enabled);
    },
  }),
];
