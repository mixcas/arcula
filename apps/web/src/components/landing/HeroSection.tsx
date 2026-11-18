import React from "react";
import {
  Anchor,
  Box,
  Button,
  Grid,
  Group,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  LANDING_ANCHORS,
  LANDING_EXAMPLE_RECORD,
  LANDING_HERO,
  type LandingExampleRecord,
} from "./content";
import { LANDING_PALETTE, LANDING_RULE } from "./palette";
import LandingSection, { LandingSectionHeading } from "./Section";

/**
 * The example record: a fictional work shown so the page's promise is
 * concrete rather than a claim.
 *
 * It is a bordered paper panel with no shadow, and it is a `section` named by
 * its own visible label so a screen reader hears "Example record" before the
 * work — the label is what keeps it from being mistaken for a screenshot or a
 * real customer's data. The work's title is not a heading: the page has one
 * h1, and the record is an illustration of it, not a subsection.
 *
 * The content comes from one object in `content.ts`; replacing the
 * placeholder with a cleared work is a change to that object alone.
 */
const RecordPanel: React.FC<{ record: LandingExampleRecord }> = ({
  record,
}) => (
  <Paper
    component="section"
    aria-label={record.label}
    shadow="none"
    radius={0}
    bg={LANDING_PALETTE.paper}
    p={{ base: "lg", md: "xl" }}
    style={{ border: LANDING_RULE }}
  >
    <Text
      size="xs"
      tt="uppercase"
      fw={600}
      c={LANDING_PALETTE.muted}
      style={{ letterSpacing: "0.14em" }}
    >
      {record.label}
    </Text>
    <Text ff="text" fz={{ base: "lg", sm: "xl" }} lh={1.2} mt="sm">
      {record.title}
    </Text>
    <Text size="sm" c={LANDING_PALETTE.muted} mt="3xs">
      {record.artist}
    </Text>

    <Box component="dl" m={0} mt="lg">
      {record.fields.map((field, index) => (
        <Box
          key={field.label}
          component="div"
          py="xs"
          style={index === 0 ? undefined : { borderTop: LANDING_RULE }}
        >
          <Text component="dt" size="xs" c={LANDING_PALETTE.muted}>
            {field.label}
          </Text>
          <Text component="dd" size="sm" m={0} mt={2}>
            {field.value}
          </Text>
        </Box>
      ))}
    </Box>

    <Text size="sm" c={LANDING_PALETTE.muted} mt="md">
      {record.caption}
    </Text>
  </Paper>
);

/**
 * The top of the landing page: the promise, the audience it is for, and the
 * page's only conversion path beside an example record.
 *
 * Two columns on a desktop and one on a phone: the copy and its actions keep
 * a readable measure in the left column while the record sits beside them,
 * and on narrow screens the record follows the actions. The primary action
 * follows the session — the same account state the header reads, no new auth
 * state — so an account holder is never sent back to a sign-up page. The
 * secondary action jumps to the section that answers its label, and both
 * sides of that jump read the same anchor constant.
 */
const HeroSection: React.FC = () => {
  const { currentUser } = useAuth();
  const primary = currentUser
    ? LANDING_HERO.actions.signedIn
    : LANDING_HERO.actions.signedOut;
  const secondary = LANDING_HERO.actions.secondary;
  const secondaryHref = `#${LANDING_ANCHORS[secondary.anchor]}`;

  return (
    <LandingSection divided={false}>
      <Grid gap={{ base: "xl", md: 48 }} align="flex-start">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="xl">
            <LandingSectionHeading order={1} heading={LANDING_HERO.headline} />
            <Text fz={{ base: "lg", md: "xl" }} lh={1.45} maw={640}>
              {LANDING_HERO.lede}
            </Text>
            <Group gap="lg" wrap="wrap">
              <Button component={Link} to={primary.href} size="md">
                {primary.label}
              </Button>
              <Anchor
                href={secondaryHref}
                size="md"
                c={LANDING_PALETTE.ink}
                underline="always"
              >
                {secondary.label}
              </Anchor>
            </Group>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <RecordPanel record={LANDING_EXAMPLE_RECORD} />
        </Grid.Col>
      </Grid>
    </LandingSection>
  );
};

export default HeroSection;
