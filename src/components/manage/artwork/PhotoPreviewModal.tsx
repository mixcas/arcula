import React, { useCallback, useEffect } from "react";
import { Modal, Group, Text, ActionIcon, Box } from "@mantine/core";
import { photoUrl } from "@/utils/artworkPhotos";
import type { ArtworkPhoto } from "@/types";

interface PhotoPreviewModalProps {
  photo: ArtworkPhoto | null;
  /** The photo's 1-based position, for the counter in the footer. */
  position?: { current: number; total: number };
  onClose: () => void;
  onNavigate?: (direction: 1 | -1) => void;
}

/**
 * Full-screen preview of one photo.
 *
 * Shows the `large` variant rather than the original: it is the highest
 * resolution that has been decoded to fit a screen, and pulling a 12-megapixel
 * original over the wire to display it in a modal is slower and heavier for no
 * visible gain. `photoUrl` falls back to the original when the variant is
 * missing, so a partially-migrated photo still opens.
 *
 * Arrow keys and the on-screen buttons step through the sequence, which is why
 * navigation is a prop: the modal does not own the list, the form does.
 */
const PhotoPreviewModal: React.FC<PhotoPreviewModalProps> = ({
  photo,
  position,
  onClose,
  onNavigate,
}) => {
  const url = photoUrl(photo, "large");

  const go = useCallback(
    (direction: 1 | -1) => {
      onNavigate?.(direction);
    },
    [onNavigate],
  );

  useEffect(() => {
    if (!photo) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        go(1);
      } else if (event.key === "ArrowLeft") {
        go(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, photo]);

  if (!photo) {
    return null;
  }

  const canStep = onNavigate !== undefined;

  return (
    <Modal
      opened
      onClose={onClose}
      fullScreen
      withCloseButton
      title={photo.name}
      // The image is the content, so the frame is padded out to give the dark
      // backdrop room and keep a portrait image from touching the edges.
      padding="lg"
      styles={{
        content: { backgroundColor: "var(--mantine-color-dark-9)" },
        header: { backgroundColor: "var(--mantine-color-dark-9)" },
        title: { color: "var(--mantine-color-dark-0)" },
        close: { color: "var(--mantine-color-dark-0)" },
      }}
    >
      <Box
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "calc(100dvh - 120px)",
        }}
      >
        {url ? (
          <img
            src={url}
            alt={photo.name}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
          />
        ) : (
          <Text c="dimmed">This image is no longer available.</Text>
        )}
      </Box>

      {position && position.total > 0 ? (
        <Group
          justify="space-between"
          mt="md"
          // Dark backdrop, so the counter and buttons need the light text.
          c="gray.3"
        >
          <Text size="sm">
            {position.current} of {position.total}
          </Text>

          {canStep && position.total > 1 ? (
            <Group gap="xs">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                aria-label="Previous image"
                disabled={position.current <= 1}
                onClick={() => go(-1)}
              >
                ←
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                aria-label="Next image"
                disabled={position.current >= position.total}
                onClick={() => go(1)}
              >
                →
              </ActionIcon>
            </Group>
          ) : (
            <span />
          )}
        </Group>
      ) : null}
    </Modal>
  );
};

export default PhotoPreviewModal;
