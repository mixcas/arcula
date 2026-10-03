import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Group, Loader, Stepper, Text } from "@mantine/core";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { collectionService } from "@/services/collectionService";
import { collectionSlug, parseId } from "@/utils/slug";
import { parseCsvText, type ParsedCsv } from "@/utils/csv";
import {
  attachIssues,
  buildImportRows,
  getMappedFields,
  isMappingComplete,
  type ColumnMapping,
  type ImportRow,
} from "@/schemas/artworkImport";
import ImportFileStep, { MAX_CSV_BYTES } from "./steps/ImportFileStep";
import MapColumnsStep from "./steps/MapColumnsStep";
import ReviewRowsStep from "./steps/ReviewRowsStep";
import ImportRunStep from "./steps/ImportRunStep";

/**
 * The CSV bulk-import flow for a collection, at
 * `/manage/collection/:collectionId/import/csv`.
 *
 * The four Mantine Stepper stages run on a single URL and hold all their state
 * in this component, so leaving the page discards the whole flow: never
 * uploaded, never persisted mid-flight. Step order is strict — the Next button
 * only enables when the current stage's precondition holds, and the stepper
 * header only lets the user click back, never forward.
 */
const CsvImportPage: React.FC = () => {
  const { collectionId: param } = useParams<{ collectionId: string }>();
  const collectionId = parseId(param ?? "");
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const userId = currentUser?.uid ?? "";

  // The collection the import writes into; its name feeds the canonical-URL
  // rewrite below, mirroring CollectionSettingsPage.
  const [loadedName, setLoadedName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Step 0 — file.
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [hasHeader, setHasHeader] = useState(true);

  // Step 1 — mapping (derived `headers`/`dataRows` below).
  const [mapping, setMapping] = useState<ColumnMapping>({});

  // Step 2 — the cleaned, editable rows plus live selection.
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  const [active, setActive] = useState(0);
  const [highestStepVisited, setHighestStepVisited] = useState(0);

  // The stepper lets the user click a visited step (always backwards) but never
  // a forward one — forward progress happens only through the Next buttons,
  // which encode each stage's precondition.
  const handleStepClick = (step: number) => {
    if (step <= highestStepVisited && step < active) {
      setActive(step);
    }
  };

  const advance = (step: number) => {
    setActive(step);
    setHighestStepVisited((h) => Math.max(h, step));
  };

  // --- collection load ------------------------------------------------------

  useEffect(() => {
    if (!collectionId || !userId) {
      return;
    }
    const fetchCollection = async () => {
      try {
        const collection = await collectionService.getCollection(collectionId);
        if (!collection) {
          setLoadError("Collection not found");
          return;
        }
        setLoadedName(collection.name ?? "");
      } catch (error) {
        console.error("Error loading import page:", error);
        setLoadError("Failed to load the collection. Please try again.");
      }
    };
    void fetchCollection();
  }, [collectionId, userId]);

  // Keep the canonical "{slug}-{id}" in the address bar once the name is known.
  useEffect(() => {
    if (!param || loadedName === null || !collectionId) {
      return;
    }
    const canonical = collectionSlug(loadedName, collectionId);
    if (canonical === param) {
      return;
    }
    void navigate(`/manage/collection/${canonical}/import/csv`, {
      replace: true,
    });
  }, [param, loadedName, collectionId, navigate]);

  // --- derived parse state --------------------------------------------------

  // Whether the first parsed row is a header is a user choice, so headers and
  // data rows are derived from `hasHeader` — flipping the toggle rederives
  // both and resets everything downstream of the file.
  const headers = useMemo(() => {
    if (!parsed || parsed.data.length === 0) {
      return [];
    }
    if (hasHeader) {
      return parsed.data[0].map((h) => h.trim());
    }
    const width = Math.max(0, ...parsed.data.map((row) => row.length));
    return Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  }, [parsed, hasHeader]);

  const dataRows = useMemo(() => {
    if (!parsed) {
      return [];
    }
    return hasHeader ? parsed.data.slice(1) : parsed.data;
  }, [parsed, hasHeader]);

  const sampleRows = useMemo(() => dataRows.slice(0, 3), [dataRows]);

  const raggedRowCount = useMemo(() => {
    if (!parsed || headers.length === 0) {
      return 0;
    }
    return dataRows.filter((row) => row.length !== headers.length).length;
  }, [parsed, headers.length, dataRows]);

  const parseErrorCount = parsed?.errors.length ?? 0;

  const canStartMapping =
    parsed !== null && headers.length > 0 && dataRows.length > 0;

  const mappingComplete = isMappingComplete(mapping);

  const mappedFields = useMemo(() => getMappedFields(mapping), [mapping]);

  // The rows the review table shows, with validation recomputed on every edit.
  const reviewRows = useMemo(() => attachIssues(rows), [rows]);

  // --- flow transitions -----------------------------------------------------

  const handleFile = useCallback(async (file: File) => {
    if (file.size > MAX_CSV_BYTES) {
      setLoadError(
        "That file is larger than 5 MB. Please trim it and try again.",
      );
      return;
    }
    const text = await file.text();
    setParsed(parseCsvText(text));
    setFileName(file.name);
    // Everything downstream of the file resets — mapping, rows and result
    // were built from a previous file.
    setMapping({});
    setRows([]);
    setSelectedRowIds(new Set());
    setActive(0);
    setHighestStepVisited(0);
    setLoadError(null);
  }, []);

  const handleHasHeaderChange = (value: boolean) => {
    setHasHeader(value);
    setMapping({});
    setRows([]);
    setSelectedRowIds(new Set());
  };

  /** Step 1 → 2: build and default-select the rows from the current mapping. */
  const goToReview = () => {
    const built = buildImportRows(headers, dataRows, mapping);
    setRows(built);
    setSelectedRowIds(new Set(built.map((row) => row.rowId)));
    advance(2);
  };

  /** Step 2 → 3: start the import run. */
  const confirmImport = useCallback(() => {
    advance(3);
  }, []);

  const resetFlow = () => {
    setParsed(null);
    setFileName(null);
    setMapping({});
    setRows([]);
    setSelectedRowIds(new Set());
    setActive(0);
    setHighestStepVisited(0);
  };

  // --- guards ---------------------------------------------------------------

  if (!collectionId) {
    return <Alert color="red">Invalid collection id</Alert>;
  }
  if (loadError) {
    return <Alert color="red">{loadError}</Alert>;
  }
  if (loadedName === null) {
    return <Loader />;
  }

  const step0Ready = canStartMapping;
  const step1Ready = mappingComplete;

  return (
    <>
      <Text size="h2" mb="xl">
        Import artworks from CSV
      </Text>
      <Text size="sm" c="dimmed" mb="xl">
        Being imported into <b>{loadedName}</b>.
      </Text>

      <Stepper active={active} onStepClick={handleStepClick}>
        <Stepper.Step label="Select file" description="Choose a CSV file">
          <ImportFileStep
            fileName={fileName}
            hasHeader={hasHeader}
            empty={dataRows.length === 0}
            rowCount={dataRows.length}
            columnCount={headers.length}
            parseErrorCount={parseErrorCount}
            raggedRowCount={raggedRowCount}
            onFile={(file) => void handleFile(file)}
            onHasHeaderChange={handleHasHeaderChange}
          />
          <Group justify="space-between" mt="xl">
            <Button
              variant="outline"
              onClick={() => void navigate(`/manage/collection/${param}`)}
            >
              Cancel
            </Button>
            <Button onClick={() => advance(1)} disabled={!step0Ready}>
              Next
            </Button>
          </Group>
        </Stepper.Step>

        <Stepper.Step label="Map columns" description="Match columns to fields">
          {parsed ? (
            <MapColumnsStep
              headers={headers}
              sampleRows={sampleRows}
              mapping={mapping}
              onMappingChange={setMapping}
            />
          ) : null}
          <Group justify="space-between" mt="xl">
            <Button variant="outline" onClick={() => setActive(0)}>
              Back
            </Button>
            <Button onClick={goToReview} disabled={!step1Ready}>
              {step1Ready ? "Next" : "Map Title and Artist Name to continue"}
            </Button>
          </Group>
        </Stepper.Step>

        <Stepper.Step
          label="Review & fix"
          description="Check the data before importing"
        >
          <ReviewRowsStep
            rows={reviewRows}
            mappedFields={mappedFields}
            selectedRowIds={selectedRowIds}
            onSelectionChange={setSelectedRowIds}
            onEditCell={(rowId, field, value) => {
              setRows((prev) =>
                prev.map((row) =>
                  row.rowId === rowId
                    ? {
                        ...row,
                        values: { ...row.values, [field]: value },
                        acquisitionDateFrom:
                          field === "acquisitionDate"
                            ? undefined
                            : row.acquisitionDateFrom,
                      }
                    : row,
                ),
              );
            }}
            onBack={() => setActive(1)}
            onConfirm={confirmImport}
          />
        </Stepper.Step>

        <Stepper.Step label="Import" description="Write to the collection">
          <ImportRunStep
            rows={reviewRows}
            selectedRowIds={selectedRowIds}
            collectionId={collectionId}
            userId={userId}
            collectionSlugParam={collectionSlug(loadedName, collectionId)}
            onReset={resetFlow}
          />
        </Stepper.Step>
      </Stepper>
    </>
  );
};

export default CsvImportPage;
