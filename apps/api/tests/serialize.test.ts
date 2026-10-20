// The serializer is pure over rows: the wire document's URL fields are
// derived from the key algebra, never stored. These cases pin the one fact
// that is easy to get wrong when the owner and the media namespace stop
// being the same string: a final URL is keyed by the collection's namespace,
// not by the artwork's `userId`.

import { describe, expect, it } from "vitest";
import { finalDocumentKey, finalPhotoKey, mediaUrl } from "../src/media/keys";
import {
  serializeArtwork,
  type ArtworkJoined,
  type ArtworkRow,
  type DocumentRow,
  type PhotoRow,
  type VariantRow,
} from "../src/serialize";

const OWNER = "owner-1";
const NAMESPACE = "namespace-1";
const CID = "col-1";
const AID = "art-1";
const PHOTO = "photo-1";
const DOC = "doc-1";

const artworkRow = (userId: string): ArtworkRow => ({
  id: AID,
  userId,
  collectionId: CID,
  title: "Study in Red",
  artistName: "C. Cas",
  serie: null,
  dateOfCreation: null,
  media: null,
  dimensions: null,
  editions: null,
  acquisitionDate: null,
  acquisitionPrice: null,
  placeOfOrigin: null,
  provenance: null,
  notes: null,
  condition: null,
  currentValue: null,
  status: "published",
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const photoRow = (): PhotoRow => ({
  id: PHOTO,
  artworkId: AID,
  order: 0,
  name: "scan.jpg",
});

const documentRow = (): DocumentRow => ({
  id: DOC,
  artworkId: AID,
  kind: "file",
  name: "certificate.pdf",
  size: 2048,
  contentType: "application/pdf",
  width: null,
  height: null,
});

const photoVariantRows = (): VariantRow[] => [
  {
    parentKind: "photo",
    parentId: PHOTO,
    key: "original",
    width: 400,
    height: 300,
    size: 1024,
    contentType: "image/jpeg",
  },
  {
    parentKind: "photo",
    parentId: PHOTO,
    key: "medium",
    width: 400,
    height: 300,
    size: 512,
    contentType: "image/webp",
  },
];

const joined: ArtworkJoined = {
  artwork: artworkRow(OWNER),
  photos: [photoRow()],
  documents: [documentRow()],
  variants: photoVariantRows(),
};

describe("serializeArtwork", () => {
  it("keys every final URL by the collection's namespace, not the artwork's userId", () => {
    const document = serializeArtwork(joined, NAMESPACE);

    expect(document.photos[0].original.url).toBe(
      mediaUrl(finalPhotoKey(NAMESPACE, CID, AID, PHOTO, "original", "jpg")),
    );
    expect(document.photos[0].variants[0].url).toBe(
      mediaUrl(finalPhotoKey(NAMESPACE, CID, AID, PHOTO, "medium", "webp")),
    );
    expect(document.documents[0].original.url).toBe(
      mediaUrl(finalDocumentKey(NAMESPACE, CID, AID, DOC, "original", "pdf")),
    );
    // The wire's `userId` is still the artwork's owner; it is not the
    // namespace and must not leak into the keys.
    expect(document.userId).toBe(OWNER);
  });
});
