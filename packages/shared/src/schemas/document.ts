import { z } from "zod";
import type { Artwork, Collection } from "../types";
import { artworkStatusSchema } from "./artwork";

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
 * Two deliberate absences, matching the serializer: a collection row never
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
  key: z.enum(["xlarge", "square_lg", "square_sm", "large", "medium"]),
  url: z.string(),
  width: z.number(),
  height: z.number(),
  size: z.number(),
  contentType: z.string(),
});

export const artworkPhotoReadSchema = z.object({
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
export const artworkDocumentReadSchema = z.discriminatedUnion("kind", [
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
 * GET /collections/{cid}/artworks/{aid} and the list's per-work rows.
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
  media: z.string().optional(),
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
  collectionId: z.string(),
  isPublic: z.boolean(),
  // Absent on a document written before the field, and read as published —
  // the same reading the old flag gets when it is absent.
  status: artworkStatusSchema.default("published"),
  deletedAt: wireTimestamp.nullable(),
  createdAt: wireTimestamp,
  updatedAt: wireTimestamp,
});

/**
 * GET /collections (list rows) and GET /collections/{cid}. The serializer
 * omits `description`, `skin` and `skinOptions` when unset — the shape a
 * document written before the fields existed had — so all three are
 * optional, as they are on the client type.
 */
export const collectionReadSchema = z.object({
  id: z.string(),
  name: z.string(),
  userId: z.string(),
  description: z.string().optional(),
  isPublic: z.boolean(),
  skin: z.string().optional(),
  skinOptions: z
    .record(z.string(), z.union([z.boolean(), z.number(), z.string()]))
    .optional(),
  createdAt: wireTimestamp,
  updatedAt: wireTimestamp,
});

export type ArtworkRead = z.infer<typeof artworkReadSchema>;
export type CollectionRead = z.infer<typeof collectionReadSchema>;

// One direction only, and that is deliberate: the wire shape must be a valid
// `Artwork`/`Collection` (asserted below), so anything the service layer
// parses can flow into every existing consumer untyped. The reverse is NOT
// asserted — the client types stay looser than the wire (absent-optional
// fields, `Timestamp | null`) so legacy documents still type-check for code
// that reads them without going through this parse.
type ArtworkWireIsArtwork = ArtworkRead extends Artwork ? true : never;
type CollectionWireIsCollection = CollectionRead extends Collection
  ? true
  : never;
const artworkWireIsArtwork: ArtworkWireIsArtwork = true;
const collectionWireIsCollection: CollectionWireIsCollection = true;
void artworkWireIsArtwork;
void collectionWireIsCollection;
