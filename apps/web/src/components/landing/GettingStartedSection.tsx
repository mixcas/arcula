import React from "react";
import { Box, Grid, Text, Title } from "@mantine/core";
import {
  LANDING_GETTING_STARTED,
  type LandingGettingStartedStep,
} from "./content";
import { LANDING_RULE } from "./palette";
import LandingSection, { LandingSectionHeading } from "./Section";

/**
 * One move: what it is called on the left, what it asks of the person on the
 * right.
 *
 * The rule above each move is the same hairline the record's fields use, so
 * the steps read as a sequence rather than as a set of tiles. The name is an
 * `h3` below the section's `h2`: it names a step, not a section.
 */
const Step: React.FC<{ step: LandingGettingStartedStep }> = ({ step }) => (
  <Box
    component="li"
    py={{ base: "lg", md: "xl" }}
    style={{ borderTop: LANDING_RULE }}
  >
    <Grid gap={{ base: "2xs", md: "xl" }} align="flex-start">
      <Grid.Col span={{ base: 12, md: 4 }}>
        <Title order={3} ff="text" fz={{ base: "xl", md: "2xl" }}>
          {step.name}
        </Title>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 8 }}>
        <Text size="md" lh={1.5} maw={640}>
          {step.detail}
        </Text>
      </Grid.Col>
    </Grid>
  </Box>
);

/**
 * The getting-started section: the three moves between a work and a record.
 *
 * The steps are an ordered list, because they are a sequence, and they stack
 * into one column on a phone. The section stops at the catalogue's own
 * decisions and does not explain the mechanics of a name or a biography —
 * those belong inside the product, once there is a catalogue to name.
 */
const GettingStartedSection: React.FC = () => (
  <LandingSection>
    <LandingSectionHeading
      label={LANDING_GETTING_STARTED.label}
      heading={LANDING_GETTING_STARTED.heading}
    />

    <Box
      component="ol"
      m={0}
      p={0}
      mt={{ base: "md", md: "lg" }}
      style={{ listStyle: "none" }}
    >
      {LANDING_GETTING_STARTED.steps.map((step) => (
        <Step key={step.name} step={step} />
      ))}
    </Box>
  </LandingSection>
);

export default GettingStartedSection;
