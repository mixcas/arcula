import React from "react";
import { Box, SimpleGrid, Text, Title } from "@mantine/core";
import { LANDING_RECORD } from "./content";
import { LANDING_PALETTE } from "./palette";
import LandingSection, { LandingSectionHeading } from "./Section";

/**
 * The record: what a catalogue has to hold that a spreadsheet cannot.
 *
 * The section is the page's argument, so it is composed as prose rather than
 * as a product grid: the heading and the lede sit in a readable measure, and
 * the three groups are columns of text under a hairline each, not cards. There
 * is no border, no surface of their own and no shadow, because the band
 * already draws the section — a card here would turn an editorial claim into a
 * feature list.
 *
 * The group names are `h3`s beneath the section's one `h2`, which keeps the
 * page's heading order intact while letting a screen reader move between the
 * three kinds of fact. On a phone the grid collapses to one column and the
 * rules become separators between the groups.
 */
const RecordSection: React.FC = () => (
  <LandingSection>
    <LandingSectionHeading
      label={LANDING_RECORD.label}
      heading={LANDING_RECORD.heading}
    />
    <Text fz={{ base: "lg", md: "xl" }} lh={1.45} maw={640} mt="lg">
      {LANDING_RECORD.lede}
    </Text>

    <SimpleGrid
      cols={{ base: 1, md: 3 }}
      spacing={{ base: 0, md: "xl" }}
      verticalSpacing="lg"
      mt={{ base: "xl", md: 48 }}
    >
      {LANDING_RECORD.groups.map((group) => (
        <Box
          key={group.title}
          pt="md"
          style={{ borderTop: `1px solid ${LANDING_PALETTE.rule}` }}
        >
          <Title order={3} fz={{ base: "lg", md: "xl" }} lh={1.25}>
            {group.title}
          </Title>
          <Text c={LANDING_PALETTE.muted} lh={1.5} mt="xs">
            {group.body}
          </Text>
        </Box>
      ))}
    </SimpleGrid>
  </LandingSection>
);

export default RecordSection;
