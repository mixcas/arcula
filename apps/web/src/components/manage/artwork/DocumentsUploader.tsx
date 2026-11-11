import React, { useState } from "react";
import {
  ActionIcon,
  Anchor,
  Box,
  Image,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconFileText,
  IconFileTypePdf,
  IconPhoto,
  IconTrash,
} from "@tabler/icons-react";
import ImagePreviewModal from "./ImagePreviewModal";
import StagedDropzone from "./StagedDropzone";
import type {
  DocumentEntry,
  UseArtworkDocuments,
} from "@/hooks/useArtworkDocuments";
import {
  ACCEPTED_DOCUMENT_TYPES,
  MAX_ARTWORK_DOCUMENTS,
  MAX_DOCUMENT_BYTES,
} from "@arcula/shared";
import { documentImageUrl, isDocumentImage } from "@/utils/artworkDocuments";

interface DocumentsUploaderProps {
  documents: UseArtworkDocuments;
  /** Shown above the list. Kept as a prop so the form owns its own copy. */
  description?: string;
}

/**
 * The "Other Documents" list for the Add and Edit Artwork forms.
 *
 * A two-column tile grid, matching the photos beside it: the square is the
 * thumbnail for an image and a content-type glyph for everything else, with the
 * name and size underneath. Two columns rather than three because a filename
 * needs more width to stay readable than a photo's index badge does.
 *
 * Deliberately headless about saving, exactly as `PhotoUploader` is — it renders
 * whatever the hook holds and calls back into it, so both forms share this whole
 * surface.
 */
const DocumentsUploader: React.FC<DocumentsUploaderProps> = ({
  documents,
  description,
}) => {
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  // Only the images have a modal, so the preview is looked up by key rather than
  // by index: removing a tile before the open one would otherwise silently show
  // a different document than the one that was clicked.
  const previewEntry = documents.entries.find(
    (entry) => entry.key === previewKey,
  );
  const previewDocument = previewEntry?.document ?? null;
  const previewImage =
    previewDocument && isDocumentImage(previewDocument)
      ? previewDocument
      : null;

  return (
    <Stack gap="sm">
      <StagedDropzone
        accept={ACCEPTED_DOCUMENT_TYPES}
        maxSize={MAX_DOCUMENT_BYTES}
        room={MAX_ARTWORK_DOCUMENTS - documents.count}
        processing={documents.processing}
        progress={documents.progress}
        onFiles={(files) => documents.addFiles(files)}
        words={{
          accept: "Add these documents",
          idle: (
            <>
              Drag files here, or click to choose up to{" "}
              {MAX_ARTWORK_DOCUMENTS - documents.count} more
            </>
          ),
          noun: "file",
          icon: <IconPhoto size={16} />,
        }}
      />

      {documents.entries.length === 0 ? (
        <Text size="sm" c="dimmed">
          No documents yet.
        </Text>
      ) : (
        <SimpleGrid cols={2} spacing="sm">
          {documents.entries.map((entry) => (
            <DocumentTile
              key={entry.key}
              entry={entry}
              onRemove={() => documents.remove(entry.key)}
              onPreview={() => setPreviewKey(entry.key)}
            />
          ))}
        </SimpleGrid>
      )}

      {description ? (
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      ) : null}

      <ImagePreviewModal
        image={previewImage}
        onClose={() => setPreviewKey(null)}
      />
    </Stack>
  );
};

/**
 * The icon for a non-image, chosen by content type.
 *
 * Content type rather than filename, because that is what the server knows:
 * the entry's `contentType` is the value the staged object was named from, so
 * it cannot disagree with what the row actually points at. A generic page glyph
 * as the fallback means a type this app did not anticipate still renders
 * sensibly instead of a blank tile — which matters more than it sounds, since
 * the list is exactly where someone would notice a file they did not expect.
 *
 * A boolean rather than a component: returning a component from a function
 * called during render is flagged by `react-hooks/static-components`, and the
 * rule is right — the component identity would change on every render.
 */
const isPdf = (contentType: string): boolean =>
  contentType === "application/pdf";

interface DocumentTileProps {
  entry: DocumentEntry;
  onRemove: () => void;
  onPreview: () => void;
}

const DocumentTile: React.FC<DocumentTileProps> = ({
  entry,
  onRemove,
  onPreview,
}) => {
  const document = entry.document;
  const isImageEntry = isDocumentImage(document);
  const thumbnail = isImageEntry ? documentImageUrl(document) : null;
  // An entry only exists once the server has answered for it, so both kinds
  // are complete: an image has its variants (and a thumbnail) and a file has
  // its original. There is no "preparing" state to draw.
  const canOpen = isImageEntry ? thumbnail !== null : !!document.original.url;

  // A file has no pixels, so its tile is a glyph chosen by content type — the
  // one fact the server knows, because it named the staged object from it.
  const glyph = (
    <ThemeIcon size={40} radius="sm" variant="light" color="gray">
      {isPdf(document.contentType) ? (
        <IconFileTypePdf size={24} />
      ) : (
        <IconFileText size={24} />
      )}
    </ThemeIcon>
  );

  return (
    <Box pos="relative">
      <Box
        style={{
          borderRadius: "var(--mantine-radius-md)",
          overflow: "hidden",
          aspectRatio: "1 / 1",
          background: "var(--mantine-color-dark-7)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {thumbnail ? (
          <UnstyledButton
            onClick={onPreview}
            aria-label={`Preview ${document.name}`}
            style={{ display: "block", width: "100%", height: "100%" }}
          >
            <Image
              src={thumbnail}
              alt={document.name}
              fit="cover"
              h="100%"
              w="100%"
              style={{ cursor: "zoom-in" }}
            />
          </UnstyledButton>
        ) : canOpen ? (
          /*
            A document opens in a new tab rather than in a modal. There is
            nothing to page through and no second size worth showing, and a PDF
            in a full-screen dark modal is a worse reader than the tab it came
            from.

            `rel="noopener noreferrer"` is not optional: without `noopener` the
            opened document gets a handle on this window via `window.opener`.
          */
          <Anchor
            href={document.original.url}
            target="_blank"
            rel="noopener noreferrer"
            underline="never"
            aria-label={`Open ${document.name}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
            }}
          >
            {glyph}
          </Anchor>
        ) : (
          glyph
        )}
      </Box>

      {/*
        The remove control is a sibling of the clickable area rather than inside
        it: a button within an anchor or a button is invalid and would swallow
        the click on some browsers.
      */}
      <Tooltip label="Remove" withArrow>
        <ActionIcon
          pos="absolute"
          top={6}
          right={6}
          size="sm"
          variant="filled"
          color="red"
          onClick={onRemove}
          aria-label={`Remove ${document.name}`}
        >
          <IconTrash size={14} />
        </ActionIcon>
      </Tooltip>

      <Text size="xs" mt={4} truncate title={document.name}>
        {document.name}
      </Text>
      <Text size="xs" c="dimmed">
        {formatBytes(document.size)}
      </Text>
    </Box>
  );
};

/** A size in the largest unit that still reads as a whole number. */
const formatBytes = (bytes: number): string => {
  if (bytes <= 0) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
};

export default DocumentsUploader;
