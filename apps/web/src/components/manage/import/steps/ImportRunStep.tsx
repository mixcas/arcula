import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Group,
  Progress,
  Stack,
  Text,
} from "@mantine/core";
import { Link } from "react-router-dom";
import { artworkService } from "@/services/artworkService";
import {
  isRowImportable,
  type ArtworkImportOutcome,
  type ReviewRow,
} from "@arcula/shared";

interface ImportRunStepProps {
  rows: ReviewRow[];
  selectedRowIds: Set<string>;
  collectionId: string;
  collectionSlugParam: string;
  onReset: () => void;
}

/**
 * Stepper step 4: commit the selected, validated rows.
 *
 * The import runs auto-start when this step mounts (reaches the review step's
 * Confirm) and cannot be repeated from here — the user goes back to start a new
 * file. It is one request, not a chunked client write: the API validates each
 * row against the shared schema and writes what passes in one transaction, so
 * there is no client-side progress to tick and the answer is the
 * `{ inserted, rejected }` outcome below.
 */
const ImportRunStep: React.FC<ImportRunStepProps> = ({
  rows,
  selectedRowIds,
  collectionId,
  collectionSlugParam,
  onReset,
}) => {
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState<ArtworkImportOutcome | null>(null);
  // The request itself failing — no session, bad id, dropped connection —
  // where nothing was written and there is no per-row answer to render.
  const [requestError, setRequestError] = useState<string | null>(null);

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
    // the only run there is — its final result would never render even though
    // the write completed (the app would sit on "Importing N artworks…"
    // forever). `selected` in the deps keeps the run correct if the parent
    // ever remounts this step with a different selection (it does not, since
    // the review gate fixed the selection before reaching here).
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const run = async () => {
      const selectedCount = selected.length;
      setTotal(selectedCount);
      if (selectedCount === 0) {
        setResult({ inserted: 0, rejected: [] });
        return;
      }

      try {
        // The server validates the raw rows; the client has already told the
        // user which rows are broken, and the ones that arrive are the ones
        // that were selected in review.
        setResult(
          await artworkService.createArtworks(
            collectionId,
            selected.map((row) => row.values),
          ),
        );
      } catch (error) {
        console.error("Import failed:", error);
        // The request itself failed (bad id, no session, transport) — no rows
        // were written at all, so there is no per-row answer to render.
        setRequestError("Import failed. The collection was left unchanged.");
        setResult({ inserted: 0, rejected: [] });
      }
    };

    void run();
  }, [selected, collectionId]);

  // Before the run finishes, show the progress line. One request means one
  // answer, so the bar is indeterminate rather than ticked by chunks.
  if (!result) {
    return (
      <Card shadow="sm" p="lg">
        <Text fw={600} mb="xs">
          Importing {total} artwork{total === 1 ? "" : "s"}…
        </Text>
        <Progress value={50} animated mb="sm" />
        <Text size="sm" c="dimmed">
          Sending to the server…
        </Text>
      </Card>
    );
  }

  const failed = result.rejected.length > 0;
  const headline =
    result.inserted === 0 && result.rejected.length === 0
      ? "Nothing was imported"
      : failed
        ? `${result.inserted} imported, ${result.rejected.length} rejected`
        : `${result.inserted} artwork${result.inserted === 1 ? "" : "s"} imported`;

  return (
    <>
      <Alert
        color={requestError ? "red" : failed ? "yellow" : "green"}
        title={headline}
        mb="md"
      >
        {result.rejected.length > 0 ? (
          <Stack gap={2}>
            {result.rejected.map((entry, index) => {
              // `row` is the index into the POSTED list — the selected rows,
              // not the lines of the file — so it points straight at the
              // review row that did not land.
              const row = selected[entry.row];
              return (
                // Indexed, not keyed on the title: two rows can share one, and a
                // duplicate key would silently drop a line from the very list
                // that explains what did not land.
                <Text key={`${index}-${entry.row}`} size="sm">
                  <Text component="span" fw={600}>
                    {row?.values.title ?? `Row ${entry.row + 1}`}
                  </Text>{" "}
                  —{" "}
                  {Object.entries(entry.errors)
                    .map(([field, message]) => `${field}: ${message}`)
                    .join(", ")}
                </Text>
              );
            })}
          </Stack>
        ) : null}
        {requestError ? <Text size="sm">{requestError}</Text> : null}
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
