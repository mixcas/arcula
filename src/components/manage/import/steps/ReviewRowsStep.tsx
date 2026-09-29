import React, { useMemo, useState } from "react";
import { Alert, Badge, Button, Group, Text } from "@mantine/core";
import { DataTable, type DataTableColumn } from "mantine-datatable";
import EditableCell from "../cells/EditableCell";
import {
  IMPORT_FIELD_BY_KEY,
  isRowImportable,
  type ImportFieldKey,
  type ReviewRow,
} from "@/schemas/artworkImport";

const RECORDS_PER_PAGE_OPTIONS = [10, 25, 50];

interface ReviewRowsStepProps {
  rows: ReviewRow[];
  /** The mapped fields, in schema order — becomes the table's columns. */
  mappedFields: ImportFieldKey[];
  selectedRowIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  /** Commit an in-cell edit for one field of one row. */
  onEditCell: (rowId: string, field: ImportFieldKey, value: string) => void;
  onBack: () => void;
  onConfirm: () => void;
}

/**
 * Stepper step 3: the full, cleaned, mapped dataset, editable cell by cell.
 *
 * Every row is selectable (all are selected by default); rows with validation
 * mistakes are tinted and the Confirm button stays blocked until every
 * *selected* row is importable — fixing the cell or deselecting the row are
 * the two ways out, exactly the contract in the spec. Duplicate titles are
 * deliberately not checked (same-title works are legitimate in art), so the
 * only notes a cell can show are the "converted from …" date one and, on top,
 * the error state from live validation.
 */
const ReviewRowsStep: React.FC<ReviewRowsStepProps> = ({
  rows,
  mappedFields,
  selectedRowIds,
  onSelectionChange,
  onEditCell,
  onBack,
  onConfirm,
}) => {
  const [page, setPage] = useState(1);
  const [recordsPerPage, setRecordsPerPage] = useState(
    RECORDS_PER_PAGE_OPTIONS[0],
  );

  // Clamp the rendered page to the row count without a sync setState-in-effect
  // (flagged by the react-hooks rule): if the dataset is re-mapped smaller
  // upstream, the table shows the highest valid page until the user changes it.
  const pageCount = Math.max(1, Math.ceil(rows.length / recordsPerPage));
  const effectivePage = Math.min(page, pageCount);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedRowIds.has(row.rowId)),
    [rows, selectedRowIds],
  );

  // The review list is live-edited, so the gate derives from the current state
  // of the selected rows, not from a snapshot taken when the step mounted.
  const blockedCount = selectedRows.filter(
    (row) => !isRowImportable(row),
  ).length;
  const confirmDisabled = selectedRows.length === 0 || blockedCount > 0;

  const columns = useMemo<DataTableColumn<ReviewRow>[]>(
    () =>
      mappedFields.map((field) => {
        const meta = IMPORT_FIELD_BY_KEY[field];
        return {
          accessor: field,
          title: meta.label,
          toggleable: mappedFields.length > 6,
          width: field === "notes" ? 280 : undefined,
          render: (row) => {
            const fieldIssue = row.issues.find(
              (issue) => issue.field === field,
            );
            const hint =
              field === "acquisitionDate" && row.acquisitionDateFrom
                ? `Converted from ${row.acquisitionDateFrom}`
                : undefined;
            return (
              <EditableCell
                value={row.values[field]}
                multiline={meta.kind === "multiline"}
                errorMessage={fieldIssue?.message}
                hint={hint}
                onCommit={(value) => onEditCell(row.rowId, field, value)}
              />
            );
          },
        };
      }),
    [mappedFields, onEditCell],
  );

  // mantine-datatable pagination is display-only: the caller slices `records`
  // to the current page and reports the grand total separately.
  const pageRecords = useMemo(
    () =>
      rows.slice(
        (effectivePage - 1) * recordsPerPage,
        effectivePage * recordsPerPage,
      ),
    [rows, effectivePage, recordsPerPage],
  );

  return (
    <>
      <Alert
        color={confirmDisabled ? "yellow" : "green"}
        title={confirmDisabled ? "Some rows need attention" : "Ready to import"}
        mb="md"
      >
        <Text size="sm">
          {selectedRows.length} of {rows.length} row
          {rows.length === 1 ? "" : "s"} selected for import
          {blockedCount > 0 ? (
            <>
              {" "}
              — {blockedCount} selected{" "}
              {blockedCount === 1 ? "row has" : "rows have"} a problem. Fix the
              cell in place, or deselect the row, to unblock.
            </>
          ) : null}
        </Text>
      </Alert>

      <Group mb="xs" gap="xs">
        <Text size="xs" c="dimmed">
          Legend:
        </Text>
        <Badge color="red" variant="light" size="xs">
          needs fixing
        </Badge>
        <Text size="xs" c="dimmed">
          Click any cell to edit it.
        </Text>
      </Group>

      <DataTable<ReviewRow>
        idAccessor="rowId"
        records={pageRecords}
        columns={columns}
        storeColumnsKey={`artwork-import-fields`}
        selectedRecords={selectedRows}
        onSelectedRecordsChange={(records) =>
          onSelectionChange(new Set(records.map((record) => record.rowId)))
        }
        rowBackgroundColor={(row) => {
          if (row.issues.length > 0) {
            // `red.2` reads clearly as "this row needs fixing" without washing
            // out the text; the exact cell carries the dashed frame + message.
            return "red.2";
          }
          return undefined;
        }}
        page={effectivePage}
        onPageChange={setPage}
        totalRecords={rows.length}
        recordsPerPage={recordsPerPage}
        onRecordsPerPageChange={setRecordsPerPage}
        recordsPerPageOptions={RECORDS_PER_PAGE_OPTIONS}
        recordsPerPageLabel="Rows per page"
        withTableBorder
        highlightOnHover
        striped={false}
        minHeight={160}
        emptyState={<Text p="xl">No rows to import.</Text>}
      />

      <Group justify="space-between" mt="xl">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onConfirm} disabled={confirmDisabled}>
          {blockedCount > 0
            ? `Fix ${blockedCount} selected row${blockedCount === 1 ? "" : "s"} to continue`
            : `Import ${selectedRows.length} artwork${selectedRows.length === 1 ? "" : "s"}`}
        </Button>
      </Group>
    </>
  );
};

export default ReviewRowsStep;
