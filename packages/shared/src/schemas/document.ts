import { z } from "zod";
import type { ArtworkFacetEntry } from "../artworkSearch";
import type { Artwork, Catalogue } from "../types";
import { artworkAvailabilitySchema, artworkStatusSchema } from "./artwork";
import { artworkFieldDeviationsSchema, catalogueKindSchema } from "./catalogue";

/**
 * The wire shape of the API's GET responses, parsed at the service boundary.
 *
 * The serializer emits a fixed document shape — same keys, same nesting,
 * `url` fields as proxy paths — so these schemas are a re-declaration of that
 * shape, not a new one: whatever they accept, the client types accept.
 * Parsing on the way in buys two things at once: a runtime
 * assertion that a server change cannot silently reshape the document the
 * app renders, and the narrowed `z.infer` type the service layer returns.
 *
 * Two deliberate absences, matching the serializer: a catalogue row never
 * carries `artworks` (it is not a client field), and blank text fields are
 * ABSENT keys, never `null` — so they are optional here, and the client's
 * looser types (`description?: string`) stay compatible with both shapes.
 */

/** The wire timestamp: `{ seconds, nanoseconds }`. */
export const wireTimestamp = z.object({
  seconds: z.number(),
  nanoseconds: z.number(),
});

/** One generated derivative on the wire — the API's variant key space. */
export const wireImageVariant = z.object({
  key: z.enum([
    "xxlarge",
    "xlarge",
    "square_lg",
    "square_sm",
    "large",
    "medium",
  ]),
  url: z.string(),
  width: z.number(),
  height: z.number(),
  size: z.number(),
  contentType: z.string(),
});

const artworkPhotoReadSchema = z.object({
  id: z.string(),
  order: z.number(),
  name: z.string(),
  size: z.number(),
  contentType: z.string(),
  width: z.number(),
  height: z.number(),
  original: z.object({
    url: z.string(),
    size: z.number(),
    contentType: z.string(),
  }),
  variants: z.array(wireImageVariant),
});

// The union on `kind`, not one shape with optionals — the same shape the
// client types use, so `z.infer` lines up with `ArtworkDocument` without a
// single `as`.
const artworkDocumentReadSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    name: z.string(),
    size: z.number(),
    contentType: z.string(),
    original: z.object({
      url: z.string(),
      size: z.number(),
      contentType: z.string(),
    }),
    kind: z.literal("file"),
  }),
  z.object({
    id: z.string(),
    name: z.string(),
    size: z.number(),
    contentType: z.string(),
    original: z.object({
      url: z.string(),
      size: z.number(),
      contentType: z.string(),
    }),
    kind: z.literal("image"),
    width: z.number(),
    height: z.number(),
    variants: z.array(wireImageVariant),
  }),
]);

/**
 * GET /catalogues/{cid}/artworks/{aid} and the list's per-work rows.
 * `deletedAt` is the one wire field that may honestly be `null`: a soft-
 * deleted work is still readable by its owner, and the serializer writes
 * the marker through.
 */
export const artworkReadSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  artistName: z.string(),
  serie: z.string().optional(),
  dateOfCreation: z.string().optional(),
  medium: z.string().optional(),
  dimensions: z.string().optional(),
  editions: z.string().optional(),
  acquisitionDate: z.string().optional(),
  acquisitionPrice: z.string().optional(),
  placeOfOrigin: z.string().optional(),
  provenance: z.string().optional(),
  notes: z.string().optional(),
  condition: z.string().optional(),
  currentValue: z.string().optional(),
  documents: z.array(artworkDocumentReadSchema),
  photos: z.array(artworkPhotoReadSchema),
  catalogueId: z.string(),
  // The owner's choice, and the only per-work field a visitor is gated on.
  // Absent on a document written before it existed, and read as `published`.
  status: artworkStatusSchema.default("published"),
  // A member read emits it, null included; a visitor's document does not
  // carry the key at all, so it is optional on the read shape.
  availability: artworkAvailabilitySchema.nullable().optional(),
  deletedAt: wireTimestamp.nullable(),
  createdAt: wireTimestamp,
  updatedAt: wireTimestamp,
});

/**
 * GET /catalogues (list rows) and GET /catalogues/{cid}. The serializer
 * omits `description`, `skin` and `skinOptions` when unset — the shape a
 * document written before the fields existed had — so all three are
 * optional, as they are on the client type.
 *
 * `role`/`ownerName` are the dashboard list's per-row extras: the signed-in
 * list emits `role` on every row and `ownerName` on a shared one, while the
 * public list and the single read emit neither. Hence optional.
 *
 * `isPasswordProtected` is the member read's one-bit answer about the
 * catalogue's password — never the hash. It is absent from every anonymous
 * read, so a visitor never learns more than the lock screen tells them.
 */
export const catalogueReadSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** What the catalogue is; chosen at creation and never rewritten. */
  kind: catalogueKindSchema,
  userId: z.string(),
  description: z.string().optional(),
  isPublic: z.boolean(),
  isPasswordProtected: z.boolean().optional(),
  role: z.enum(["owner", "collaborator"]).optional(),
  ownerName: z.string().optional(),
  skin: z.string().optional(),
  skinOptions: z
    .record(z.string(), z.union([z.boolean(), z.number(), z.string()]))
    .optional(),
  // The sparse deviations the serializer emits on every audience, visitors
  // included — the public PDF resolves the same enabled set from them. Absent
  // when the catalogue never deviated.
  artworkFields: artworkFieldDeviationsSchema.optional(),
  createdAt: wireTimestamp,
  updatedAt: wireTimestamp,
});

export type ArtworkRead = z.infer<typeof artworkReadSchema>;

/** One value and how many works carry it, as a facet answers it. */
const artworkFacetEntrySchema = z.object({
  value: z.string(),
  count: z.number(),
});

// The wire entry and the pure shape the API counts are one shape; a field
// added to one and not the other fails the build.
type FacetWireIsFacet =
  z.infer<typeof artworkFacetEntrySchema> extends ArtworkFacetEntry
    ? ArtworkFacetEntry extends z.infer<typeof artworkFacetEntrySchema>
      ? true
      : never
    : never;
const facetWireIsFacet: FacetWireIsFacet = true;
void facetWireIsFacet;

/**
 * GET /catalogues/{cid}/artworks: a page of work documents and the facts that
 * describe the page.
 *
 * `total` is the number of matches before paging; `limit` is `null` when the
 * request named none, which means every match came back; `offset` is what the
 * request asked for (zero when it asked nothing). `facets` is present only
 * when the request named fields, one ordered list per field, counted over the
 * filtered set rather than the page.
 */
export const artworkPageSchema = z.object({
  artworks: z.array(artworkReadSchema),
  total: z.number(),
  limit: z.number().nullable(),
  offset: z.number(),
  facets: z.record(z.string(), z.array(artworkFacetEntrySchema)).optional(),
});

export type ArtworkPage = z.infer<typeof artworkPageSchema>;

export type CatalogueRead = z.infer<typeof catalogueReadSchema>;

// One direction only, and that is deliberate: the wire shape must be a valid
// `Artwork`/`Catalogue` (asserted below), so anything the service layer
// parses can flow into every existing consumer untyped. The reverse is NOT
// asserted — the client types stay looser than the wire (absent-optional
// fields, `Timestamp | null`) so legacy documents still type-check for code
// that reads them without going through this parse.
type ArtworkWireIsArtwork = ArtworkRead extends Artwork ? true : never;
type CatalogueWireIsCatalogue = CatalogueRead extends Catalogue ? true : never;
const artworkWireIsArtwork: ArtworkWireIsArtwork = true;
const catalogueWireIsCatalogue: CatalogueWireIsCatalogue = true;
void artworkWireIsArtwork;
void catalogueWireIsCatalogue;
