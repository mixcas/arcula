import React, { useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Group,
  Image,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import PhotoPreviewModal from "./PhotoPreviewModal";
import type { PhotoEntry, UseArtworkPhotos } from "@/hooks/useArtworkPhotos";
import { photoUrl } from "@/utils/artworkPhotos";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_ARTWORK_PHOTOS,
} from "@/utils/imageVariants";
import type { ArtworkPhoto } from "@/types";

interface PhotoUploaderProps {
  photos: UseArtworkPhotos;
  /** Shown above the grid. Kept as a prop so the form owns its own copy. */
  description?: string;
}

/**
 * The image list for the Add and Edit Artwork forms.
 *
 * Deliberately headless about saving: it renders whatever the hook holds and
 * calls back into it, so the two forms share this whole surface and neither
 * one has to know about object URLs, reordering or the preview.
 */
const PhotoUploader: React.FC<PhotoUploaderProps> = ({
  photos,
  description,
}) => {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // A keyboard sensor as well as the pointer one: reordering images is exactly
  // the kind of list a keyboard user should be able to rearrange, and
  // `sortableKeyboardCoordinates` is what makes space/enter work.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const from = photos.entries.findIndex((entry) => entry.key === active.id);
    const to = photos.entries.findIndex((entry) => entry.key === over.id);
    photos.reorder(from, to);
  };

  const openPreview = (index: number) => setPreviewIndex(index);

  const stepPreview = (direction: 1 | -1) => {
    setPreviewIndex((current) => {
      if (current === null) {
        return current;
      }
      // Wraps, because arrow-key stepping that stops dead at the end is
      // annoying; the buttons are disabled instead, so this is the keyboard
      // path being more forgiving, not less.
      const next =
        (current + direction + photos.entries.length) % photos.entries.length;
      return next;
    });
  };

  const previewPhoto = previewPhotoAt(photos.entries, previewIndex);

  return (
    <Stack gap="sm">
      <Dropzone
        onDrop={(files) => {
          void photos.addFiles(files);
        }}
        // The files have already been chosen by the time this fires, so the
        // hook re-validates each one. That is the point: Dropzone's accept
        // list is a file-picker hint and the OS can still hand over anything.
        accept={ACCEPTED_IMAGE_TYPES}
        maxSize={10 * 1024 * 1024}
        maxFiles={Math.max(1, MAX_ARTWORK_PHOTOS - photos.count)}
        disabled={!photos.hasRoom || photos.processing}
        // The grid below is the reorder affordance, so dropping onto a tile
        // here would be a second, conflicting way to order the list.
        onReject={() => undefined}
      >
        <Group
          justify="center"
          gap="xl"
          mih={90}
          style={{ pointerEvents: "none" }}
        >
          <Dropzone.Accept>
            <Text size="sm">Add these images</Text>
          </Dropzone.Accept>
          <Dropzone.Reject>
            <Text size="sm">That file cannot be added</Text>
          </Dropzone.Reject>
          <Dropzone.Idle>
            <Text size="sm">
              Drag images here, or click to choose up to{" "}
              {MAX_ARTWORK_PHOTOS - photos.count} more
            </Text>
          </Dropzone.Idle>
        </Group>
      </Dropzone>

      {photos.processing && photos.progress ? (
        <Progress
          value={(photos.progress.done / photos.progress.total) * 100}
          animated
          aria-label="Preparing images"
        />
      ) : null}

      {/*
        Stated rather than inferred. The JPEG fallback is silent by design —
        a browser that cannot encode WebP gets a correct, working, and entirely
        silent downgrade, and the only evidence is that every object in Storage
        is a `.jpg`. One line here is cheaper than that discovery.
      */}
      {photos.variantWebp === false ? (
        <Alert
          color="yellow"
          icon="⚠"
          title="This browser will store JPEG instead of WebP"
        >
          It cannot encode WebP through a canvas, so the generated image sizes
          are saved as JPEG at the same quality. The originals are unaffected.
        </Alert>
      ) : null}

      {photos.entries.length === 0 ? (
        <Text size="sm" c="dimmed">
          No images yet. The first image is the one used as the thumbnail
          everywhere in the app.
        </Text>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={photos.entries.map((entry) => entry.key)}
            strategy={rectSortingStrategy}
          >
            <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
              {photos.entries.map((entry, index) => (
                <SortableTile
                  key={entry.key}
                  entry={entry}
                  index={index}
                  isPrimary={index === 0}
                  onRemove={() => photos.remove(entry.key)}
                  onMakePrimary={() => photos.makePrimary(entry.key)}
                  onPreview={() => openPreview(index)}
                />
              ))}
            </SimpleGrid>
          </SortableContext>
        </DndContext>
      )}

      {description ? (
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      ) : null}

      <PhotoPreviewModal
        photo={previewPhoto.photo}
        position={{
          current: previewPhoto.index + 1,
          total: photos.entries.length,
        }}
        onClose={() => setPreviewIndex(null)}
        onNavigate={stepPreview}
      />
    </Stack>
  );
};

/**
 * The `ArtworkPhoto` an entry should be displayed through.
 *
 * A pending photo has none of its own until the variants are generated, so it
 * falls back to a stand-in built from them. Returning `null` for an unprocessed
 * pending photo is honest — `photoUrl` then yields nothing, and the tile shows
 * its box rather than a broken image.
 */
const previewPhotoFor = (entry: PhotoEntry): ArtworkPhoto | null =>
  entry.status === "stored" ? entry.photo : entry.preview;

/** The photo at an index, or `null` when the index is out of range. */
const previewPhotoAt = (
  entries: PhotoEntry[],
  index: number | null,
): { photo: ArtworkPhoto | null; index: number } => {
  if (index === null) {
    return { photo: null, index: 0 };
  }
  const entry = entries[index];
  if (!entry) {
    return { photo: null, index: 0 };
  }
  return { photo: previewPhotoFor(entry), index };
};

interface SortableTileProps {
  entry: PhotoEntry;
  index: number;
  isPrimary: boolean;
  onRemove: () => void;
  onMakePrimary: () => void;
  onPreview: () => void;
}

const SortableTile: React.FC<SortableTileProps> = ({
  entry,
  index,
  isPrimary,
  onRemove,
  onMakePrimary,
  onPreview,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.key });

  const style = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
      // Lifted while dragging, so the tile visibly leaves the grid and the
      // gap it came from is obvious.
      zIndex: isDragging ? 2 : undefined,
      opacity: isDragging ? 0.85 : 1,
    }),
    [transform, transition, isDragging],
  );

  const src = photoUrl(previewPhotoFor(entry), "square_lg") ?? "";

  return (
    <Box
      ref={setNodeRef}
      style={style}
      pos="relative"
      // The whole tile is the drag handle. A dedicated grip would be more
      // discoverable, but a full-tile handle is the only one that works
      // reliably on touch, which is where this gets used.
      {...attributes}
      {...listeners}
    >
      <Box
        pos="relative"
        style={{
          borderRadius: "var(--mantine-radius-md)",
          overflow: "hidden",
          aspectRatio: "1 / 1",
          background: "var(--mantine-color-dark-7)",
        }}
      >
        {src ? (
          <Image
            src={src}
            alt={labelFor(entry)}
            fit="cover"
            h="100%"
            onClick={onPreview}
            // The tile is a drag handle, so a plain click would otherwise be
            // swallowed by the listeners' pointer capture.
            style={{ cursor: "zoom-in" }}
          />
        ) : null}

        <Badge
          size="xs"
          variant="filled"
          color={isPrimary ? "blue" : "dark"}
          pos="absolute"
          top={6}
          left={6}
          style={{ pointerEvents: "none" }}
        >
          {isPrimary ? "Thumbnail" : index + 1}
        </Badge>

        <Group
          gap={4}
          pos="absolute"
          top={6}
          right={6}
          // The overlay buttons are inside the drag handle, so each stops
          // propagation to keep a click from starting a drag.
          onPointerDown={(event) => event.stopPropagation()}
        >
          {!isPrimary ? (
            <Tooltip label="Use as thumbnail" withArrow>
              <ActionIcon
                size="sm"
                variant="filled"
                color="dark"
                onClick={onMakePrimary}
                aria-label="Use as thumbnail"
              >
                ★
              </ActionIcon>
            </Tooltip>
          ) : null}
          <Tooltip label="Remove" withArrow>
            <ActionIcon
              size="sm"
              variant="filled"
              color="red"
              onClick={onRemove}
              aria-label="Remove image"
            >
              ✕
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>

      <Text size="xs" c="dimmed" mt={4} truncate>
        {labelFor(entry)}
      </Text>
    </Box>
  );
};

/** The filename for a stored photo, or its pending original name. */
const labelFor = (entry: PhotoEntry): string =>
  entry.status === "stored" ? entry.photo.name : entry.file.name;

export default PhotoUploader;
