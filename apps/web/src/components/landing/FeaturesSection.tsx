import React from "react";
import { Box, SimpleGrid, Text } from "@mantine/core";
import { LANDING_ANCHORS, LANDING_FEATURES } from "./content";
import { LANDING_RULE } from "./palette";
import LandingSection, { LandingSectionHeading } from "./Section";

/**
 * What Arcula does: six capabilities under the anti-pipeline heading.
 *
 * A two-column hairline list on a desktop and one column on a phone — not a
 * grid of cards. A card would turn each capability into a product tile, and
 * the page's argument is that the record is the unit, so the capabilities are
 * read as a list of facts about one product. The rule above each item is the
 * only separation; there is no shadow and no surface of its own.
 *
 * The capability names are sub-headings below the section's h2 rather than
 * display type, so the heading hierarchy stays one h1, one h2 per section and
 * h3 for what sits under it.
 *
 * The section carries the `whatItDoes` anchor: the hero's secondary action
 * jumps here, and both ends read the same constant from `content.ts`.
 */
const FeaturesSection: React.FC = () => (
  <LandingSection id={LANDING_ANCHORS.whatItDoes}>
    <LandingSectionHeading
      label={LANDING_FEATURES.label}
      heading={LANDING_FEATURES.heading}
    />
    <Text fz={{ base: "lg", md: "xl" }} lh={1.45} maw={640} mt="lg">
      {LANDING_FEATURES.lede}
    </Text>

    <SimpleGrid
      cols={{ base: 1, md: 2 }}
      spacing={{ base: "md", md: 48 }}
      verticalSpacing={0}
      mt={{ base: "xl", md: 40 }}
    >
      {LANDING_FEATURES.items.map((item) => (
        <Box key={item.name} py="lg" style={{ borderTop: LANDING_RULE }}>
          <Text component="h3" ff="text" fz="lg" fw={600} lh={1.25} m={0}>
            {item.name}
          </Text>
          <Text size="md" lh={1.45} mt="xs" maw={520}>
            {item.body}
          </Text>
        </Box>
      ))}
    </SimpleGrid>
  </LandingSection>
);

export default FeaturesSection;
