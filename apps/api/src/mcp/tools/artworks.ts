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
  artworkCreateSchema,
  artworkUpdateSchema,
  parseArtworkSearchQuery,
  type ArtworkRead,
  type ArtworkSearchProblem,
} from "@arcula/shared";
import { readArtwork, readArtworkList } from "../../artworkRead";
import { createArtworkFor, updateArtworkFor } from "../../artworkWrite";
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
 * One work as a search row names it: identity, status, the market state, the
 * medium and the two dates — never photos, documents or variants.
 *
 * The absent keys follow the wire document's rules rather than inventing
 * values: `availability` is the member's fact (a visitor's work has no key at
 * all) and a blank text field is absent, so a summary reads like the document
 * it summarizes.
 */
const workSummary = (work: ArtworkRead) => ({
  id: work.id,
  title: work.title,
  artistName: work.artistName,
  status: work.status,
  ...(work.availability === undefined
    ? {}
    : { availability: work.availability }),
  ...(work.medium === undefined ? {} : { medium: work.medium }),
  ...(work.dateOfCreation === undefined
    ? {}
    : { dateOfCreation: work.dateOfCreation }),
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
      return {
        total: read.total,
        limit: read.limit,
        offset: read.offset,
        artworks: read.artworks.map(workSummary),
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
      return read.artwork;
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
      "unless named). Availability is a market state for a Portfolio or an " +
      "Inventory: a Collection carries no Availability, so one sent on any " +
      "Kind is recorded, as the API allows, and is never shown on a " +
      "Collection. Any member — the Owner or a Collaborator — may create " +
      "works; a non-member is refused. Use search_artworks to read a " +
      "Catalogue's works. Photos and documents are uploaded in the app, not " +
      "here.",
    inputSchema: createArtworkInput,
    write: true,
    call: async ({ catalogueId, ...fields }, userId) =>
      createArtworkFor(userId, catalogueId, fields),
  }),

  defineTool({
    name: "update_artwork",
    description:
      "Change the fields a call names on one Artwork and answer the work as " +
      "written. Every field is optional and only the fields sent change — " +
      "title, artistName, serie, dateOfCreation, medium, dimensions, " +
      "editions, acquisitionDate, acquisitionPrice, placeOfOrigin, " +
      "provenance, notes, condition, currentValue, status and availability. " +
      "A text field sent as `null` clears it. A Collection carries no " +
      "Availability: one sent on any Kind is recorded, as the API allows, " +
      "and is never shown on a Collection. Any member may write; a missing " +
      "or invisible Artwork answers `not-found`. Use search_artworks to find " +
      "an Artwork's id.",
    inputSchema: updateArtworkInput,
    write: true,
    call: async ({ catalogueId, artworkId, ...fields }, userId) =>
      updateArtworkFor(userId, catalogueId, artworkId, fields),
  }),
];
