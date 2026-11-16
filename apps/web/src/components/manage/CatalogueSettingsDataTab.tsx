/**
 * The settings page's Data tab: the card that leads to the CSV import, and —
 * below it, for the owner alone — the danger card that deletes the catalogue.
 *
 * The import keeps its card and gains a tab; the button links to the import
 * page the route table already knows. The tab has no Save, which is why it
 * takes the address's catalogue segment rather than the save machinery. The
 * danger card does its own access read and draws nothing for a collaborator,
 * so this file only hands it the identity the loaded document carries.
 */

import React from "react";
import { Box, Button, Card, Group, Stack, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import CatalogueDangerCard, {
  type CatalogueIdentity,
} from "./catalogue/CatalogueDangerCard";

interface DataTabProps {
  /** The address's catalogue segment, "{slug}-{id}" — the import's route. */
  catalogueParam: string;
  /** The loaded document's identity, for the danger card. */
  catalogue: CatalogueIdentity;
}

const DataTab: React.FC<DataTabProps> = ({ catalogueParam, catalogue }) => {
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
              Add artworks in bulk from a comma-separated values file.
            </Text>
          </Box>
          <Button
            component={Link}
            to={`/manage/catalogue/${catalogueParam}/import/csv`}
          >
            Import
          </Button>
        </Group>
      </Card>
      <CatalogueDangerCard catalogue={catalogue} />
    </Stack>
  );
};

export default DataTab;
