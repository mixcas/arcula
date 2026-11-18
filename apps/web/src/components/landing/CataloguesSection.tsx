import React from "react";
import { Box, SimpleGrid, Text, Title } from "@mantine/core";
import { LANDING_CATALOGUES, type LandingCatalogueKind } from "./content";
import { LANDING_PALETTE } from "./palette";
import LandingSection, { LandingSectionHeading } from "./Section";

/**
 * One catalogue kind: its name and the audience it speaks to.
 *
 * The rule sits above the name rather than around the block, so the three
 * kinds read as three columns of one page rather than as three products. There
 * is no panel, no shadow and no radius: a card here would say the kinds are
 * separate things to buy, which is the opposite of the section's point.
 */
const CatalogueKind: React.FC<LandingCatalogueKind> = ({ name, audience }) => (
  <Box
    pt={{ base: "md", md: "lg" }}
    style={{ borderTop: `1px solid ${LANDING_PALETTE.rule}` }}
  >
    <Title order={3} fz={{ base: "xl", md: "2xl" }}>
      {name}
    </Title>
    <Text size="md" c={LANDING_PALETTE.muted} lh={1.45} mt="2xs">
      {audience}
    </Text>
  </Box>
);

/**
 * The catalogues section: the three kinds, and the fact that one account can
 * hold all three.
 *
 * Three columns on a desktop and one on a phone. The audience line is what
 * makes the kinds a decision rather than a taxonomy, and the closing line is
 * set in the display face because it is the section's answer, not a footnote.
 * The kind names are `h3`s under the section's `h2`: they label a part of the
 * section, they do not start a new one.
 */
const CataloguesSection: React.FC = () => (
  <LandingSection>
    <LandingSectionHeading
      label={LANDING_CATALOGUES.label}
      heading={LANDING_CATALOGUES.heading}
    />

    <SimpleGrid
      cols={{ base: 1, md: 3 }}
      spacing={{ base: "lg", md: "xl" }}
      mt={{ base: "lg", md: "xl" }}
    >
      {LANDING_CATALOGUES.kinds.map((kind) => (
        <CatalogueKind key={kind.name} {...kind} />
      ))}
    </SimpleGrid>

    <Text
      ff="heading"
      fz={{ base: "lg", md: "xl" }}
      mt={{ base: "lg", md: "xl" }}
    >
      {LANDING_CATALOGUES.closing}
    </Text>
  </LandingSection>
);

export default CataloguesSection;
