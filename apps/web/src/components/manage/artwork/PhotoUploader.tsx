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
import { Dropzone, type FileRejection } from "@mantine/dropzone";
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
import { IconPhoto } from "@tabler/icons-react";
import ImagePreviewModal from "./ImagePreviewModal";
import type { PhotoEntry, UseArtworkPhotos } from "@/hooks/useArtworkPhotos";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_ARTWORK_PHOTOS,
  MAX_IMAGE_BYTES,
  photoUrl,
} from "@arcula/shared";
import type { ArtworkPhoto } from "@arcula/shared";

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
  const [rejected, setRejected] = useState<string[]>([]);

  // Never swallowed. The hook's pre-checks are cap and type, and the stage
  // route adds the size cap and the decode — a file that silently vanished
  // from the grid is worse than a message, so every refusal lands here.
  const handleDrop = async (files: File[]) => {
    const result = await photos.addFiles(files);
    // Appended, and skipped when empty: the reject handler below fires
    // synchronously for the files the Dropzone's own validator refused, and
    // this settles a tick later. Replacing here would erase that half of the
    // list the moment the staging settled, and the two halves are disjoint —
    // a file is either validator-refused or hook-processed, never both.
    if (result.rejected.length === 0) {
      return;
    }
    setRejected((current) => [
      ...current,
      ...result.rejected.map((entry) => `${entry.file.name}: ${entry.reason}`),
    ]);
  };

  // The other rejection path, and the one that actually fires for an
  // oversized file or a type the `accept` hint did not stop: Dropzone checks
  // them itself and never hands those files to `onDrop`, so an unhandled
  // `onReject` means a too-large image produces a one-frame flicker and no
  // explanation. This fires synchronously, before any staging has settled, so
  // it starts the list and the hook's rejections are appended to it.
  const handleReject = (failures: FileRejection[]) => {
    setRejected(
      failures.map(
        (failure) =>
          `${failure.file.name}: ${failure.errors
            .map((error) => error.message)
            .join(", ")}`,
      ),
    );
  };

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
          void handleDrop(files);
        }}
        // `accept` is enforced twice: the Dropzone's validator refuses a
        // mismatch on the way in (the `onReject` path below), and the hook
        // re-checks the same list for any caller that bypasses the component.
        // Neither spends a round trip on a wrong type.
        accept={ACCEPTED_IMAGE_TYPES}
        maxSize={MAX_IMAGE_BYTES}
        maxFiles={Math.max(1, MAX_ARTWORK_PHOTOS - photos.count)}
        disabled={!photos.hasRoom || photos.processing}
        onReject={handleReject}
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

      {rejected.length > 0 ? (
        <Alert
          color="yellow"
          icon={<IconPhoto size={16} />}
          title={`${rejected.length} image${rejected.length === 1 ? "" : "s"} could not be added`}
          withCloseButton
          onClose={() => setRejected([])}
        >
          <Stack gap={2}>
            {rejected.map((line, index) => (
              // Indexed, not keyed on the line: two files can share a name and a
              // reason — a folder of `scan.jpg`s is ordinary — and a duplicate
              // key silently drops a row from the very alert meant to say what
              // went missing.
              <Text key={`${index}-${line}`} size="xs">
                {line}
              </Text>
            ))}
          </Stack>
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

      <ImagePreviewModal
        image={previewPhoto.photo}
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
 * A staged photo's stand-in carries the server's own urls — the staged
 * original and the variants it generated — so it renders through exactly the
 * same `photoUrl` ladder as a stored one, and there is no intermediate
 * "preparing" shape: an entry only exists once its variants are in hand.
 */
const previewPhotoFor = (entry: PhotoEntry): ArtworkPhoto =>
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

/** The filename for a stored photo, or its staged one. */
const labelFor = (entry: PhotoEntry): string =>
  entry.status === "stored" ? entry.photo.name : entry.preview.name;

export default PhotoUploader;
