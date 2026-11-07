import React, { useMemo } from "react";
import { Badge, Box, Button, Card, Checkbox, Group, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import {
  artworkSlug,
  artworkSearchSuffix,
  primaryPhoto,
  primaryPhotoUrl,
} from "@arcula/shared";
import type { Artwork } from "@arcula/shared";
import { artworkCardAspect } from "@/components/manage/collection/artworkCardGeometry";

export interface ArtworkCardProps {
  artwork: Artwork;
  /** The "{slug}-{id}" collection param, reused verbatim in the card links. */
  collectionParam: string;
  /** The committed Collection search; Edit carries it back, View does not. */
  searchQuery?: string;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  /** Ask the list to confirm and soft-delete this work. */
  onConfirmDeleteArtwork: (artwork: Artwork) => void;
}

/**
 * One artwork as a photo card in the Grid.
 *
 * The card is a presentation of the same facts the Table row shows, so two
 * choices are copied from it on purpose: View is a plain `<a>` to the public
 * page (`target="_blank"`, `noopener`) because it leaves the app, and Edit is a
 * router `Link` that carries the collection search back so saving returns to
 * the results being read.
 *
 * Three things are not obvious from the markup:
 *
 * - **The photo box is reserved from the variant's own dimensions.** The first
 *   paint would otherwise jump as each image lands, which in a masonry grid
 *   moves every card below it. The `medium` variant is fit-inside and keeps the
 *   photo's aspect, so its recorded width and height are the box's ratio, and
 *   `object-fit: cover` crops to the clamped band. The alt is empty for the
 *   same reason as the table thumbnail's: the title is directly below.
 * - **The checkbox sits over the card, not in its flow.** It is positioned at
 *   the top-right of the image, and of the body when a work has no photo, so a
 *   card's height does not depend on whether it is selectable.
 * - **The body is not a link.** A card is a reading surface first; a click on
 *   its title or image doing nothing is what keeps ticking its checkbox and
 *   selecting its text from navigating away.
 */
const ArtworkCard: React.FC<ArtworkCardProps> = ({
  artwork,
  collectionParam,
  searchQuery = "",
  selected,
  onSelectedChange,
  onConfirmDeleteArtwork,
}) => {
  const image = useMemo(() => {
    const src = primaryPhotoUrl(artwork, "medium");
    if (!src) return null;
    // `primaryPhotoUrl` reads the same primary photo this does, so the variant
    // looked up here is the one whose URL was just chosen; the fallback to the
    // source dimensions covers a photo uploaded before `medium` existed, when
    // the URL is the original.
    const photo = primaryPhoto(artwork);
    const variant = photo?.variants?.find((entry) => entry.key === "medium");
    const aspect = artworkCardAspect(
      variant?.width ?? photo?.width ?? 0,
      variant?.height ?? photo?.height ?? 0,
    );
    return { src, aspect };
  }, [artwork]);

  const href = `/collection/${collectionParam}/artwork/${artworkSlug(
    artwork.title,
    artwork.id,
  )}`;
  const editTo = `/manage/collection/${collectionParam}/artwork/${artworkSlug(
    artwork.title,
    artwork.id,
  )}${artworkSearchSuffix(searchQuery.trim())}`;

  return (
    <Card
      withBorder
      p={0}
      shadow="sm"
      // The tint, not only the border, is what reads from across a 3-column
      // grid: a 1 px border on a selected card is invisible at a glance.
      bg={selected ? "var(--mantine-color-blue-0)" : undefined}
      style={{
        borderColor: selected ? "var(--mantine-color-blue-6)" : undefined,
        overflow: "hidden",
      }}
      data-selected={selected ? "true" : undefined}
    >
      <Box style={{ position: "relative" }}>
        {image ? (
          <Card.Section>
            <img
              src={image.src}
              alt=""
              loading="lazy"
              style={{
                display: "block",
                width: "100%",
                // The reserved ratio: `padding` would work too, but a fixed
                // aspect box lets the image fill it exactly.
                aspectRatio: `1 / ${image.aspect}`,
                objectFit: "cover",
              }}
            />
          </Card.Section>
        ) : null}
        <Checkbox
          checked={selected}
          onChange={(event) => onSelectedChange(event.currentTarget.checked)}
          aria-label={`Select ${artwork.title}`}
          // A translucent backing so the box reads over any photo, and
          // `stopPropagation` so the click is the checkbox's alone.
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "absolute",
            top: "var(--mantine-spacing-xs)",
            right: "var(--mantine-spacing-xs)",
            backgroundColor: "var(--mantine-color-body)",
            borderRadius: "var(--mantine-radius-xs)",
            padding: 4,
          }}
        />
      </Box>

      <Box p="md">
        <Group gap="xs" wrap="wrap" align="center">
          <Text fw={500} style={{ overflowWrap: "anywhere" }}>
            {artwork.title}
          </Text>
          {artwork.status === "draft" ? (
            <Badge color="gray" variant="light" size="sm">
              Draft
            </Badge>
          ) : null}
        </Group>
        <Text size="sm" c="dimmed" mt={4}>
          {artwork.artistName}
        </Text>
        <Group gap="xs" mt="sm" wrap="nowrap">
          <Button
            size="compact-xs"
            variant="default"
            component="a"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            View
          </Button>
          <Button
            size="compact-xs"
            variant="default"
            component={Link}
            to={editTo}
          >
            Edit
          </Button>
          <Button
            size="compact-xs"
            color="red"
            variant="light"
            onClick={() => onConfirmDeleteArtwork(artwork)}
          >
            Delete
          </Button>
        </Group>
      </Box>
    </Card>
  );
};

export default ArtworkCard;
