import React, { useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Box,
  Group,
  Image,
  Paper,
  Progress,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { Dropzone, type FileRejection } from "@mantine/dropzone";
import {
  IconFileText,
  IconFileTypePdf,
  IconPhoto,
  IconTrash,
} from "@tabler/icons-react";
import PhotoPreviewModal from "./PhotoPreviewModal";
import type {
  DocumentEntry,
  UseArtworkDocuments,
} from "@/hooks/useArtworkDocuments";
import {
  ACCEPTED_DOCUMENT_TYPES,
  MAX_ARTWORK_DOCUMENTS,
  MAX_DOCUMENT_BYTES,
  documentImageUrl,
  fileExtension,
  isDocumentImage,
} from "@/utils/artworkDocuments";
import type { ArtworkDocument, ArtworkDocumentImage } from "@/types";

interface DocumentsUploaderProps {
  documents: UseArtworkDocuments;
  /** Shown above the list. Kept as a prop so the form owns its own copy. */
  description?: string;
}

/**
 * The "Other Documents" list for the Add and Edit Artwork forms.
 *
 * A row per attachment rather than a grid, because this list has no sequence to
 * read across: a grid implies an order worth comparing, and there is not one.
 * Rows are a scannable list of things with names, which is what these are.
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
  const [rejected, setRejected] = useState<string[]>([]);

  // Only the images have a modal, so the preview is looked up by key rather than
  // by index: removing a row above the open one would otherwise silently show a
  // different document than the one that was clicked.
  const previewEntry = documents.entries.find(
    (entry) => entry.key === previewKey,
  );
  const previewDocument = previewEntry
    ? displayDocumentFor(previewEntry)
    : null;
  const previewImage =
    previewDocument && isDocumentImage(previewDocument)
      ? previewDocument
      : null;

  const handleDrop = async (files: File[]) => {
    const result = await documents.addFiles(files);
    // Never swallowed. The accept list here is broader than the photos one, so
    // a mixed drop rejecting half its files is an ordinary thing to do, and a
    // file that silently vanished from the list is worse than a message.
    setRejected(
      result.rejected.map((entry) => `${entry.file.name}: ${entry.reason}`),
    );
  };

  // The other rejection path, and the one that actually fires for an oversized
  // file: Dropzone checks `maxSize` itself and never calls `onDrop`, so an
  // unhandled `onReject` means a 30 MB PDF produces a one-frame flicker of
  // "That file cannot be added" and no explanation. The 25 MiB cap makes that
  // routine rather than exotic, so the reason is folded into the same list.
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

  return (
    <Stack gap="sm">
      <Dropzone
        onDrop={(files) => {
          void handleDrop(files);
        }}
        // The files have already been chosen by the time this fires, so the hook
        // re-validates each one. That is the point: Dropzone's accept list is a
        // file-picker hint and the OS can still hand over anything.
        accept={ACCEPTED_DOCUMENT_TYPES}
        maxSize={MAX_DOCUMENT_BYTES}
        maxFiles={Math.max(1, MAX_ARTWORK_DOCUMENTS - documents.count)}
        disabled={!documents.hasRoom || documents.processing}
        onReject={handleReject}
      >
        <Group
          justify="center"
          gap="xl"
          mih={90}
          style={{ pointerEvents: "none" }}
        >
          <Dropzone.Accept>
            <Text size="sm">Add these documents</Text>
          </Dropzone.Accept>
          <Dropzone.Reject>
            <Text size="sm">That file cannot be added</Text>
          </Dropzone.Reject>
          <Dropzone.Idle>
            <Text size="sm">
              Drag files here, or click to choose up to{" "}
              {MAX_ARTWORK_DOCUMENTS - documents.count} more
            </Text>
          </Dropzone.Idle>
        </Group>
      </Dropzone>

      {documents.processing && documents.progress ? (
        <Progress
          value={(documents.progress.done / documents.progress.total) * 100}
          animated
          aria-label="Preparing images"
        />
      ) : null}

      {rejected.length > 0 ? (
        <Alert
          color="yellow"
          icon={<IconPhoto size={16} />}
          title={`${rejected.length} file${rejected.length === 1 ? "" : "s"} could not be added`}
          withCloseButton
          onClose={() => setRejected([])}
        >
          <Stack gap={2}>
            {rejected.map((line, index) => (
              // Indexed, not keyed on the line: two files can share a name and a
              // reason — a folder of `scan.pdf`s is ordinary — and a duplicate
              // key silently drops a row from the very alert meant to say what
              // went missing.
              <Text key={`${index}-${line}`} size="xs">
                {line}
              </Text>
            ))}
          </Stack>
        </Alert>
      ) : null}

      {documents.entries.length === 0 ? (
        <Text size="sm" c="dimmed">
          No documents yet.
        </Text>
      ) : (
        <Stack gap="xs">
          {documents.entries.map((entry) => (
            <DocumentRow
              key={entry.key}
              entry={entry}
              onRemove={() => documents.remove(entry.key)}
              onPreview={() => setPreviewKey(entry.key)}
            />
          ))}
        </Stack>
      )}

      {description ? (
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      ) : null}

      <PhotoPreviewModal
        photo={previewImage}
        onClose={() => setPreviewKey(null)}
      />
    </Stack>
  );
};

/** The stored document, or the transient stand-in for a pending one. */
const displayDocumentFor = (entry: DocumentEntry): ArtworkDocument =>
  entry.status === "stored"
    ? entry.document
    : (entry.preview ?? emptyDocument(entry));

/**
 * A placeholder for a pending image whose variants have not finished encoding.
 *
 * It has to be an `ArtworkDocument` for the caller to branch on `kind`, and it
 * has to be recognisable as "nothing yet" — hence no URL, which is what makes
 * the row render its box rather than a broken image.
 */
const emptyDocument = (entry: DocumentEntry): ArtworkDocumentImage => ({
  id: "",
  kind: "image",
  name: entry.status === "stored" ? entry.document.name : entry.file.name,
  size: entry.status === "stored" ? entry.document.size : entry.file.size,
  contentType: "",
  width: 0,
  height: 0,
  original: { url: "", size: 0, contentType: "" },
  variants: [],
});

/**
 * The icon for a non-image, chosen by extension.
 *
 * Extension rather than content type, because the badge is there to tell the
 * user which file they picked. A generic page glyph as the fallback means a
 * type this app did not anticipate still renders sensibly instead of a blank
 * tile — which matters more than it sounds, since the list is exactly where
 * someone would notice a file they did not expect.
 *
 * A boolean rather than a component: returning a component from a function
 * called during render is flagged by `react-hooks/static-components`, and the
 * rule is right — the component identity would change on every render.
 */
const isPdf = (name: string): boolean => fileExtension(name) === "pdf";

interface DocumentRowProps {
  entry: DocumentEntry;
  onRemove: () => void;
  onPreview: () => void;
}

const DocumentRow: React.FC<DocumentRowProps> = ({
  entry,
  onRemove,
  onPreview,
}) => {
  const document = displayDocumentFor(entry);
  const isImageEntry = isDocumentImage(document);
  const thumbnail = isImageEntry ? documentImageUrl(document) : null;
  // A file is ready the moment it is added — there is nothing to generate. Only
  // an image waits, and only until its variants land, so this must not key off
  // `status === "pending"` or a PDF would say "preparing" forever.
  const isPreparing = entry.status === "pending" && isImageEntry && !thumbnail;
  // A pending image has no variants yet, so there is nothing to open; the row
  // stays a plain, non-interactive label until the pipeline lands.
  const canOpen = isImageEntry ? thumbnail !== null : !!document.original.url;

  const leading = thumbnail ? (
    <Image
      src={thumbnail}
      alt={document.name}
      w={44}
      h={44}
      fit="cover"
      radius="sm"
      style={{ flexShrink: 0 }}
    />
  ) : (
    <ThemeIcon
      size={44}
      radius="sm"
      variant="light"
      color="gray"
      style={{ flexShrink: 0 }}
    >
      {isPreparing ? (
        // Distinguishes "an image that is still encoding" from "a file": a
        // photo glyph, not a page glyph, so the row does not appear to have
        // changed kind halfway through.
        <IconPhoto size={22} />
      ) : isPdf(document.name) ? (
        <IconFileTypePdf size={22} />
      ) : (
        <IconFileText size={22} />
      )}
    </ThemeIcon>
  );

  const label = (
    <Box style={{ minWidth: 0, flex: 1 }}>
      <Text size="sm" truncate>
        {document.name}
      </Text>
      <Text size="xs" c="dimmed">
        {formatBytes(document.size)}
        {isPreparing ? " · preparing" : ""}
      </Text>
    </Box>
  );

  return (
    <Paper withBorder p="xs" radius="sm">
      <Group gap="sm" wrap="nowrap">
        {canOpen && isImageEntry ? (
          <UnstyledButton
            onClick={onPreview}
            aria-label={`Preview ${document.name}`}
            style={{ display: "flex", flexShrink: 0 }}
          >
            {leading}
          </UnstyledButton>
        ) : (
          leading
        )}

        {/*
          A document opens in a new tab rather than in a modal. There is nothing
          to page through and no second size worth showing, and a PDF in a
          full-screen dark modal is a worse reader than the tab it came from.

          `rel="noopener noreferrer"` is not optional: without `noopener` the
          opened document gets a handle on this window via `window.opener`.
        */}
        {canOpen && !isImageEntry ? (
          <Anchor
            href={document.original.url}
            target="_blank"
            rel="noopener noreferrer"
            underline="never"
            style={{ flex: 1, minWidth: 0, color: "inherit" }}
          >
            {label}
          </Anchor>
        ) : (
          label
        )}

        <Tooltip label="Remove" withArrow>
          <ActionIcon
            variant="subtle"
            color="red"
            onClick={onRemove}
            aria-label={`Remove ${document.name}`}
          >
            <IconTrash size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Paper>
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
