/**
 * The settings page's Data tab: the card that leads to the CSV import.
 *
 * The import keeps its card and gains a tab; the button links to the import
 * page the route table already knows. There is nothing to save here — the tab
 * has no Save, which is also why it takes the address's collection segment
 * rather than a document: its only job is to build that link.
 */

import React from "react";
import { Box, Button, Card, Group, Text } from "@mantine/core";
import { Link } from "react-router-dom";

interface DataTabProps {
  /** The address's collection segment, "{slug}-{id}" — the import's route. */
  collectionParam: string;
}

const DataTab: React.FC<DataTabProps> = ({ collectionParam }) => {
  return (
    <Card shadow="sm" p="lg">
      <Group grow justify="space-between" align="center" gap="xl" wrap="nowrap">
        <Box>
          <Text fw={600}>Import from CSV</Text>
          <Text size="sm" c="dimmed">
            Add artworks in bulk from a comma-separated values file. The file is
            parsed in this browser tab — nothing is uploaded until you confirm
            the import.
          </Text>
        </Box>
        <Button
          component={Link}
          to={`/manage/collection/${collectionParam}/import/csv`}
        >
          Import
        </Button>
      </Group>
    </Card>
  );
};

export default DataTab;
