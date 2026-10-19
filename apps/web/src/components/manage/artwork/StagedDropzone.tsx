import React, { useState } from "react";
import { Alert, Group, Progress, Stack, Text } from "@mantine/core";
import { Dropzone, type FileRejection } from "@mantine/dropzone";
import type { Rejection } from "@/hooks/useUploadPool";

/**
 * The words one list uses for the files it holds, and its alert icon.
 *
 * The lines the two lists share are written once; the ones that name the list
 * ("images" against "files", and the accept line) come from here.
 */
export interface StagedDropzoneWords {
  /** The Dropzone's own accept line: "Add these images". */
  accept: string;
  /**
   * The idle caption. The caller writes it because it has to count its own
   * remaining room, and only the caller knows what the list calls them.
   */
  idle: React.ReactNode;
  /** The alert's noun, singular: "3 images could not be added". */
  noun: string;
  icon: React.ReactNode;
}

interface StagedDropzoneProps {
  /**
   * The Dropzone's validator list — Mantine's own `Record<mime, extensions>`
   * shape, which is also what the shared caps export. The hook re-checks it.
   */
  accept: Record<string, string[]>;
  maxSize: number;
  /** How many more the list can take. */
  room: number;
  /** The pool's state, so the block can disable itself and show the bar. */
  processing: boolean;
  progress: { done: number; total: number } | null;
  /** Stage the drop; the answer's `rejected` half is what the alert shows. */
  onFiles: (files: File[]) => Promise<{ rejected: Rejection[] }>;
  words: StagedDropzoneWords;
}

/**
 * The drop target, the progress bar and the rejection alert both artwork lists
 * wear.
 *
 * Two rejection paths, and a file can take only one of them: the Dropzone's own
 * validator refuses an oversized file or a wrong type synchronously and never
 * hands it to `onDrop` (an unhandled `onReject` is a one-frame flicker and no
 * explanation), while the hook refuses what the validator let through — the cap,
 * and whatever the stage route adds. So the validator's lines come first and the
 * hook's are appended a tick later: a replacement would erase the first half.
 *
 * `accept` is enforced on both sides on purpose — the validator spends no round
 * trip on a wrong type, and the hook is the check a caller that bypasses this
 * component cannot skip.
 */
const StagedDropzone: React.FC<StagedDropzoneProps> = ({
  accept,
  maxSize,
  room,
  processing,
  progress,
  onFiles,
  words,
}) => {
  const [rejected, setRejected] = useState<string[]>([]);

  // Never swallowed: a file that silently vanished from the list is worse than
  // a message, so every refusal the hook reports lands here.
  const handleDrop = async (files: File[]) => {
    const result = await onFiles(files);
    if (result.rejected.length === 0) {
      return;
    }
    setRejected((current) => [
      ...current,
      ...result.rejected.map((entry) => `${entry.file.name}: ${entry.reason}`),
    ]);
  };

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
    <>
      <Dropzone
        onDrop={(files) => {
          void handleDrop(files);
        }}
        accept={accept}
        maxSize={maxSize}
        maxFiles={Math.max(1, room)}
        disabled={room <= 0 || processing}
        onReject={handleReject}
      >
        <Group
          justify="center"
          gap="xl"
          mih={90}
          style={{ pointerEvents: "none" }}
        >
          <Dropzone.Accept>
            <Text size="sm">{words.accept}</Text>
          </Dropzone.Accept>
          <Dropzone.Reject>
            <Text size="sm">That file cannot be added</Text>
          </Dropzone.Reject>
          <Dropzone.Idle>
            <Text size="sm">{words.idle}</Text>
          </Dropzone.Idle>
        </Group>
      </Dropzone>

      {processing && progress ? (
        <Progress
          value={(progress.done / progress.total) * 100}
          animated
          aria-label="Preparing images"
        />
      ) : null}

      {rejected.length > 0 ? (
        <Alert
          color="yellow"
          icon={words.icon}
          title={`${rejected.length} ${words.noun}${
            rejected.length === 1 ? "" : "s"
          } could not be added`}
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
    </>
  );
};

export default StagedDropzone;
