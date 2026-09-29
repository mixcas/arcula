import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Group, Progress, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import { artworkService } from "@/services/artworkService";
import {
  isRowImportable,
  toImportArtwork,
  type ImportResult,
  type ReviewRow,
} from "@/schemas/artworkImport";

interface ImportRunStepProps {
  rows: ReviewRow[];
  selectedRowIds: Set<string>;
  collectionId: string;
  userId: string;
  collectionSlugParam: string;
  onReset: () => void;
}

/**
 * Stepper step 4: commit the selected, validated rows.
 *
 * The import runs auto-start when this step mounts (reaches the review step's
 * Confirm) and cannot be repeated from here — the user goes back to start a new
 * file. Progress ticks per committed chunk; each chunk is a `writeBatch` of up
 * to CHUNK_SIZE documents, so a several-hundred-row file is a handful of
 * commits, not one per artwork.
 */
const ImportRunStep: React.FC<ImportRunStepProps> = ({
  rows,
  selectedRowIds,
  collectionId,
  userId,
  collectionSlugParam,
  onReset,
}) => {
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Set the moment the run starts; survives StrictMode's double effect run so
  // the write cannot be triggered twice. See the effect comment below.
  const startedRef = useRef(false);

  const selected = useMemo(
    () =>
      rows.filter(
        (row) => selectedRowIds.has(row.rowId) && isRowImportable(row),
      ),
    [rows, selectedRowIds],
  );

  useEffect(() => {
    // Run once on mount. The ref guard is the only StrictMode defense this
    // code needs: under React StrictMode (dev), an effect runs setup →
    // cleanup → setup, and the setup is what must not repeat — an import is a
    // side-effecting write of real documents, so starting it twice would
    // duplicate rows. The cleanup must therefore do nothing: the second setup
    // here is blocked by `startedRef`, so cancelling on cleanup would silence
    // the only run there is — its progress ticks and final result would never
    // render even though the Firestore writes completed (the app would sit on
    // "Importing N artworks…" forever). `selected` in the deps keeps the run
    // correct if the parent ever remounts this step with a different selection
    // (it does not, since the review gate fixed the selection before reaching
    // here).
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const run = async () => {
      const selectedCount = selected.length;
      setTotal(selectedCount);
      if (selectedCount === 0) {
        setResult({
          imported: 0,
          deselected: rows.length,
          failed: 0,
        });
        return;
      }

      try {
        const payloads = selected.map((row) =>
          toImportArtwork(row.values, collectionId, userId),
        );
        const outcome = await artworkService.createArtworks(
          payloads,
          setProgress,
        );
        setResult({
          imported: outcome.created,
          deselected: rows.length - selectedCount,
          failed: outcome.failed,
        });
      } catch (error) {
        console.error("Import failed:", error);
        setResult({
          imported: 0,
          deselected: rows.length - selectedCount,
          failed: selectedCount,
          error: "Import failed. The collection was left unchanged.",
        });
      }
    };

    void run();
  }, [selected, collectionId, userId, rows.length]);

  // Before the run finishes, show the progress line.
  if (!result) {
    const done = total > 0 ? progress / total : 0;
    return (
      <Card shadow="sm" p="lg">
        <Text fw={600} mb="xs">
          Importing {total} artwork{total === 1 ? "" : "s"}…
        </Text>
        <Progress value={done * 100} animated={done < 1} mb="sm" />
        <Text size="sm" c="dimmed">
          {done < 1 ? `${progress} of ${total} committed…` : "Finalizing…"}
        </Text>
      </Card>
    );
  }

  const failed = result.failed > 0;
  const headline =
    result.imported === 0 && result.failed === 0
      ? "Nothing was imported"
      : failed
        ? `${result.imported} imported, ${result.failed} failed`
        : `${result.imported} artwork${result.imported === 1 ? "" : "s"} imported`;

  return (
    <>
      <Alert color={failed ? "red" : "green"} title={headline} mb="md">
        {result.deselected > 0 ? (
          <Text size="sm">
            {result.deselected} row{result.deselected === 1 ? "" : "s"} were
            left out — deselected in the review step.
          </Text>
        ) : null}
        {result.error ? <Text size="sm">{result.error}</Text> : null}
      </Alert>

      <Group justify="center" mt="xl">
        <Button onClick={onReset} variant="outline">
          Import another file
        </Button>
        <Button
          component={Link}
          to={`/manage/collection/${collectionSlugParam}`}
        >
          View collection
        </Button>
      </Group>
    </>
  );
};

export default ImportRunStep;
