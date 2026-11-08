/**
 * The settings page's Data tab: the card that leads to the CSV import, and —
 * below it, for the owner alone — the danger card that deletes the collection.
 *
 * The import keeps its card and gains a tab; the button links to the import
 * page the route table already knows. The tab has no Save, which is why it
 * takes the address's collection segment rather than the save machinery. The
 * danger card does its own access read and draws nothing for a collaborator,
 * so this file only hands it the identity the loaded document carries.
 */

import React from "react";
import { Box, Button, Card, Group, Stack, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import type { Collection } from "@arcula/shared";
import CollectionDangerCard from "./collection/CollectionDangerCard";

interface DataTabProps {
  /** The address's collection segment, "{slug}-{id}" — the import's route. */
  collectionParam: string;
  /** The loaded document's identity, for the danger card. */
  collection: Pick<Collection, "id" | "name">;
}

const DataTab: React.FC<DataTabProps> = ({ collectionParam, collection }) => {
  return (
    <Stack gap="lg">
      <Card shadow="sm" p="lg">
        <Group
          grow
          justify="space-between"
          align="center"
          gap="xl"
          wrap="nowrap"
        >
          <Box>
            <Text fw={600}>Import from CSV</Text>
            <Text size="sm" c="dimmed">
              Add artworks in bulk from a comma-separated values file. The file
              is parsed in this browser tab — nothing is uploaded until you
              confirm the import.
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
      <CollectionDangerCard collection={collection} />
    </Stack>
  );
};

export default DataTab;
