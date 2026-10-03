import React from "react";
import { Button, Card, Group, Select, Table, Text } from "@mantine/core";
import {
  ARTWORK_IMPORT_FIELDS,
  guessColumnMapping,
  type ColumnMapping,
  type ImportFieldKey,
} from "@/schemas/artworkImport";

interface MapColumnsStepProps {
  headers: string[];
  /** The first 3 data rows, used as live examples under each column. */
  sampleRows: string[][];
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
}

/**
 * Stepper step 2: decide which CSV column feeds which artwork field.
 *
 * The Select shows a "Don't import this column" option plus every importable
 * field (with the required marker). A field already claimed by another column
 * is disabled so two columns cannot both feed `title`. Completeness — both
 * `title` and `artistName` mapped — is what unlocks the Next button; it is
 * evaluated here so the button state can derive from it.
 */
const MapColumnsStep: React.FC<MapColumnsStepProps> = ({
  headers,
  sampleRows,
  mapping,
  onMappingChange,
}) => {
  // Fields already assigned, so the same field cannot map twice.
  const claimed = new Set(
    Object.values(mapping).filter(Boolean) as ImportFieldKey[],
  );

  const setColumn = (columnIndex: number, field: string) => {
    const next: ColumnMapping = { ...mapping };
    if (field === "") {
      delete next[columnIndex];
    } else {
      // The Select offers only ImportFieldKey values plus "", so any other
      // string here would be a program bug caught at compile time (the data
      // array is drawn from ARTWORK_IMPORT_FIELDS).
      next[columnIndex] = field as ImportFieldKey;
    }
    onMappingChange(next);
  };

  return (
    <>
      <Group justify="space-between" align="center" mb="md">
        <Text size="sm" c="dimmed">
          Match each column to an artwork field. The first three data rows are
          shown as previews. Only{" "}
          <Text component="span" fw={600} inherit>
            Title
          </Text>{" "}
          and{" "}
          <Text component="span" fw={600} inherit>
            Artist Name
          </Text>{" "}
          are required.
        </Text>
        <Button
          variant="light"
          onClick={() => onMappingChange(guessColumnMapping(headers))}
          disabled={headers.length === 0}
        >
          Auto-map columns
        </Button>
      </Group>

      <Card shadow="sm" p={0} withBorder>
        <Table striped highlightOnHover verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={40}>#</Table.Th>
              <Table.Th>CSV column</Table.Th>
              <Table.Th w={260}>Imports as</Table.Th>
              <Table.Th>Sample values (first 3 rows)</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {headers.map((header, index) => (
              <Table.Tr key={index}>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {index + 1}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text fw={600} size="sm" lineClamp={1}>
                    {header || "(empty header)"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Select
                    placeholder="Don't import this column"
                    data={[
                      { value: "", label: "Don't import this column" },
                      ...ARTWORK_IMPORT_FIELDS.map((field) => ({
                        value: field.key,
                        label: `${field.label}${field.required ? " (required)" : ""}`,
                        disabled:
                          claimed.has(field.key) &&
                          mapping[index] !== field.key,
                      })),
                    ]}
                    value={mapping[index] ?? ""}
                    onChange={(value) => setColumn(index, value ?? "")}
                    allowDeselect={false}
                    comboboxProps={{ withinPortal: true }}
                    searchable
                    maxDropdownHeight={280}
                  />
                </Table.Td>
                <Table.Td>
                  {sampleRows.map((row, rowIndex) => (
                    <Text
                      key={rowIndex}
                      size="xs"
                      c="dimmed"
                      lineClamp={1}
                      ff="monospace"
                    >
                      {row[index] ?? ""}
                    </Text>
                  ))}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </>
  );
};

export default MapColumnsStep;
