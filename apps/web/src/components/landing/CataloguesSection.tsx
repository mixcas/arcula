import React from "react";
import { Box, SimpleGrid, Text, Title } from "@mantine/core";
import { catalogueSurface, kindColorVar } from "@/catalogueSurface";
import { KIND_ICONS } from "@/catalogueKindIcons";
import { LANDING_CATALOGUES, type LandingCatalogueKind } from "./content";
import { LANDING_PALETTE } from "./palette";
import LandingSection, { LandingSectionHeading } from "./Section";

/**
 * One catalogue kind, wearing the code the app gives it: the kind's glyph and
 * its colour, the same pairing the create-catalogue picker teaches.
 *
 * The card is presentational. It borrows the picker's border and glyph colours
 * but none of its controls — no radio, no check badge, no hover, no shadow —
 * because the kinds are not a choice to make here; the closing line is what
 * says an account holds all three. The card is paper with a shade-3 edge, not
 * the picker's white body, so the three panels sit on the page's surface
 * rather than cutting holes in it.
 */
const CatalogueKind: React.FC<LandingCatalogueKind> = ({ kind, audience }) => {
  const { kindLabel, kindColor } = catalogueSurface(kind);
  const Icon = KIND_ICONS[kind];

  return (
    <Box
      p={{ base: "lg", md: "xl" }}
      style={{
        backgroundColor: LANDING_PALETTE.paper,
        border: `1px solid ${kindColorVar(kindColor, 3)}`,
      }}
    >
      <Icon
        size={28}
        weight="regular"
        color={kindColorVar(kindColor, 7)}
        aria-hidden
      />
      <Title order={3} ff="text" fz={{ base: "xl", md: "2xl" }} mt="sm">
        {kindLabel}
      </Title>
      <Text size="md" c={LANDING_PALETTE.muted} lh={1.45} mt="2xs">
        {audience}
      </Text>
    </Box>
  );
};

/**
 * The catalogues section: the three kinds, and the fact that one account can
 * hold all three.
 *
 * Three cards on a desktop and one on a phone. Each wears its kind's colour
 * and glyph — the same code the badges and the create picker use — so a
 * visitor who meets the product elsewhere recognises the vocabulary. The
 * cards carry no control: this is recognition, not selection, and the closing
 * line is what keeps the section from reading as a role choice.
 *
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
        <CatalogueKind key={kind.kind} {...kind} />
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
