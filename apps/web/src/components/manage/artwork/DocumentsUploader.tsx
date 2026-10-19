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
import ImagePreviewModal from "./ImagePreviewModal";
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
  const previewDocument = previewEntry?.document ?? null;
  const previewImage =
    previewDocument && isDocumentImage(previewDocument)
      ? previewDocument
      : null;

  const handleDrop = async (files: File[]) => {
    const result = await documents.addFiles(files);
    // Never swallowed. The accept list here is broader than the photos one, so
    // a mixed drop rejecting half its files is an ordinary thing to do, and a
    // file that silently vanished from the list is worse than a message.
    //
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

  // The other rejection path, and the one that actually fires for an oversized
  // file: Dropzone checks `maxSize` itself and never calls `onDrop`, so an
  // unhandled `onReject` means a 30 MB PDF produces a one-frame flicker of
  // "That file cannot be added" and no explanation. The 25 MiB cap makes that
  // routine rather than exotic. This fires synchronously, before any staging
  // has settled, so it starts the list and the hook's rejections are appended
  // to it.
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
        // `accept` is enforced twice: the Dropzone's validator refuses a
        // mismatch on the way in (the `onReject` path below), and the hook
        // re-checks the same list for any caller that bypasses the component.
        // Neither spends a round trip on a wrong type.
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
  const document = entry.document;
  const isImageEntry = isDocumentImage(document);
  const thumbnail = isImageEntry ? documentImageUrl(document) : null;
  // An entry only exists once the server has answered for it, so both kinds
  // are complete: an image has its variants (and a thumbnail) and a file has
  // its original. There is no "preparing" state to draw.
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
      {isPdf(document.contentType) ? (
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
