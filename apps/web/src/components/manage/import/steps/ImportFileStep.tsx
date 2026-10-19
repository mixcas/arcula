import React from "react";
import { Alert, Card, Group, Switch, Text } from "@mantine/core";
import { Dropzone, type FileWithPath } from "@mantine/dropzone";

/** 5 MB — generous for real exports, small enough to die fast on garbage. */
export const MAX_CSV_BYTES = 5 * 1024 * 1024;

interface ImportFileStepProps {
  fileName: string | null;
  hasHeader: boolean;
  /** True when every bitmap is at the default (no rows yet). */
  empty: boolean;
  rowCount: number;
  columnCount: number;
  parseErrorCount: number;
  raggedRowCount: number;
  onFile: (file: FileWithPath) => void;
  onHasHeaderChange: (hasHeader: boolean) => void;
}

/**
 * Stepper step 1: pick the CSV and decide whether its first row is a header.
 *
 * The file is read and parsed in-browser only — nothing in this flow uploads
 * the file. papaparse errors (bad quoting, impossible delimiters) and the
 * ragged-row count (rows whose field count differs from the header's) are
 * surfaced here as warnings rather than hard stops; the mapping step still
 * lets the user work with whatever parsed.
 */
const ImportFileStep: React.FC<ImportFileStepProps> = ({
  fileName,
  hasHeader,
  empty,
  rowCount,
  columnCount,
  parseErrorCount,
  raggedRowCount,
  onFile,
  onHasHeaderChange,
}) => {
  const showWarning = parseErrorCount > 0 || raggedRowCount > 0;

  return (
    <>
      <Dropzone
        onDrop={(files) => {
          const file = files[0];
          if (file) {
            onFile(file);
          }
        }}
        accept={{
          // macOS, Windows/Excel and plain-text tooling disagree about what
          // MIME type a CSV is, so the common ones are each pinned to the
          // .csv extension. The object form also keeps extension-based
          // matching alive — a CSV the OS reports as application/octet-stream
          // is still accepted because its extension is in these lists, which
          // the bare string[].form would have dropped with a console warning.
          "text/csv": [".csv"],
          "application/csv": [".csv"],
          "text/plain": [".csv"],
          "application/vnd.ms-excel": [".csv"],
        }}
        maxSize={MAX_CSV_BYTES}
        multiple={false}
      >
        <Group
          justify="center"
          gap="xl"
          mih={120}
          style={{ pointerEvents: "none" }}
        >
          <div>
            <Text size="xl" inline>
              {fileName
                ? "Choose another CSV file"
                : "Drag a CSV file here or click to select"}
            </Text>
            <Text size="sm" c="dimmed" inline mt={7}>
              The file is parsed in this browser tab — nothing is uploaded.
            </Text>
          </div>
        </Group>
      </Dropzone>

      <Card shadow="sm" p="lg" mt="md">
        <Group justify="space-between" align="center">
          <div>
            <Text fw={600}>{fileName ?? "No file selected"}</Text>
            <Text size="sm" c="dimmed" mt={4}>
              {empty
                ? "Waiting for a file…"
                : `${rowCount} data row${rowCount === 1 ? "" : "s"} · ${columnCount} column${columnCount === 1 ? "" : "s"}`}
            </Text>
          </div>
          <Switch
            label="First row is a header"
            checked={hasHeader}
            disabled={empty}
            onChange={(e) => onHasHeaderChange(e.currentTarget.checked)}
          />
        </Group>
      </Card>

      {showWarning ? (
        <Alert color="yellow" mt="md" title="The file parsed with warnings">
          <Text size="sm">
            {parseErrorCount > 0
              ? `${parseErrorCount} parse error${parseErrorCount === 1 ? "" : "s"} (e.g. unbalanced quotes). The file was parsed as-is — check the mapped preview before importing. `
              : ""}
            {raggedRowCount > 0
              ? `${raggedRowCount} row${raggedRowCount === 1 ? "" : "s"} ha${raggedRowCount === 1 ? "s" : "ve"} a different number of fields than the header. Missing cells will be treated as empty and extra cells ignored.`
              : ""}
          </Text>
        </Alert>
      ) : null}
    </>
  );
};

export default ImportFileStep;
