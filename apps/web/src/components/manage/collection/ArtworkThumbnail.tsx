import React from "react";
import { Image } from "@mantine/core";
import { primaryPhotoUrl } from "@arcula/shared";
import type { Artwork } from "@arcula/shared";

/**
 * A work's first photo as a small square, for a table row.
 *
 * The alt is empty on purpose: every table that renders this also renders the
 * work's title in the next cell, so naming the image again would make a screen
 * reader say every row twice. The image is decoration on an identifier, not an
 * identifier of its own.
 *
 * No photo means no element rather than a placeholder — a grey box in an empty
 * cell reads as a broken image and says nothing the row does not already.
 *
 * Lazy loading is the default for both callers: a table page can hold fifty
 * rows, and only the visible thumbnails need fetching.
 */
const ArtworkThumbnail: React.FC<{ artwork: Artwork }> = ({ artwork }) => {
  const src = primaryPhotoUrl(artwork, "square_sm");
  if (!src) return null;
  return (
    <Image
      src={src}
      alt=""
      w={48}
      h={48}
      fit="cover"
      radius="sm"
      loading="lazy"
    />
  );
};

export default ArtworkThumbnail;
