import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Group, Loader, Stepper, Text } from "@mantine/core";
import { useNavigate, useParams } from "react-router-dom";
import { catalogueService } from "@/services/catalogueService";
import { catalogueSlug, parseId, resolveArtworkFields } from "@arcula/shared";
import type { Catalogue } from "@arcula/shared";
import { parseCsvText, type ParsedCsv } from "@/utils/csv";
import {
  attachIssues,
  buildImportRows,
  getMappedFields,
  isMappingComplete,
  skippedImportColumns,
  type ColumnMapping,
  type ImportRow,
} from "@arcula/shared";
import ImportFileStep, { MAX_CSV_BYTES } from "./steps/ImportFileStep";
import MapColumnsStep from "./steps/MapColumnsStep";
import ReviewRowsStep from "./steps/ReviewRowsStep";
import ImportRunStep from "./steps/ImportRunStep";

/**
 * The CSV bulk-import flow for a catalogue, at
 * `/manage/catalogue/:catalogueId/import/csv`.
 *
 * The four Mantine Stepper stages run on a single URL and hold all their state
 * in this component, so leaving the page discards the whole flow: never
 * uploaded, never persisted mid-flight. Step order is strict — the Next button
 * only enables when the current stage's precondition holds, and the stepper
 * header only lets the user click back, never forward.
 */
const CsvImportPage: React.FC = () => {
  const { catalogueId: param } = useParams<{ catalogueId: string }>();
  const catalogueId = parseId(param ?? "");
  const navigate = useNavigate();

  // The catalogue the import writes into: its name feeds the canonical-URL
  // rewrite below, mirroring CatalogueSettingsPage, and its Kind plus stored
  // deviations decide which fields the mapping may target.
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
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

  // --- catalogue load ------------------------------------------------------

  useEffect(() => {
    if (!catalogueId) {
      return;
    }
    const fetchCatalogue = async () => {
      try {
        const loaded = await catalogueService.getCatalogue(catalogueId);
        if (!loaded) {
          setLoadError("Catalogue not found");
          return;
        }
        setCatalogue(loaded);
      } catch (error) {
        console.error("Error loading import page:", error);
        setLoadError("Failed to load the catalogue. Please try again.");
      }
    };
    void fetchCatalogue();
  }, [catalogueId]);

  const loadedName = catalogue?.name ?? null;

  // The record's shape, resolved from the same catalogue document the server
  // resolves: the mapping may only target these fields, and the run summary
  // names the columns whose field is not among them.
  const enabledFields = useMemo(
    () =>
      catalogue
        ? resolveArtworkFields(catalogue.kind, catalogue.artworkFields).enabled
        : null,
    [catalogue],
  );

  // Keep the canonical "{slug}-{id}" in the address bar once the name is known.
  useEffect(() => {
    if (!param || loadedName === null || !catalogueId) {
      return;
    }
    const canonical = catalogueSlug(loadedName, catalogueId);
    if (canonical === param) {
      return;
    }
    void navigate(`/manage/catalogue/${canonical}/import/csv`, {
      replace: true,
    });
  }, [param, loadedName, catalogueId, navigate]);

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

  // The columns the file carries that this catalogue cannot hold. Computed
  // from the headers and the enabled set, never from a row, and handed to the
  // run summary — a skipped column is not a row failure.
  const skippedColumns = useMemo(
    () => (enabledFields ? skippedImportColumns(headers, enabledFields) : []),
    [headers, enabledFields],
  );

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

  if (!catalogueId) {
    return <Alert color="red">Invalid catalogue id</Alert>;
  }
  if (loadError) {
    return <Alert color="red">{loadError}</Alert>;
  }
  if (loadedName === null || enabledFields === null) {
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
              onClick={() => void navigate(`/manage/catalogue/${param}`)}
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
              enabledFields={enabledFields}
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

        <Stepper.Step label="Import" description="Write to the catalogue">
          <ImportRunStep
            rows={reviewRows}
            selectedRowIds={selectedRowIds}
            catalogueId={catalogueId}
            catalogueSlugParam={catalogueSlug(loadedName, catalogueId)}
            skippedColumns={skippedColumns}
            onReset={resetFlow}
          />
        </Stepper.Step>
      </Stepper>
    </>
  );
};

export default CsvImportPage;
