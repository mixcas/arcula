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
  LANDING_HERO,
  LANDING_HERO_RECORD,
  type LandingHeroRecord,
} from "./content";
import { LANDING_PALETTE, LANDING_RULE } from "./palette";
import LandingSection, { LandingSectionHeading } from "./Section";

/**
 * The hero's record: a real work, credited to its artist.
 *
 * It is a bordered paper panel with no shadow, and it opens with the work's
 * plate — the photograph at the panel's own width, at its own aspect ratio, so
 * the whole work is seen and nothing is cropped to make a layout tidy. The
 * intrinsic `width`/`height` reserve the plate's space before it lands.
 *
 * The record's facts sit in a two-column definition grid on any panel wide
 * enough for one (the columns collapse to one on a narrow screen), which is
 * what keeps six fields from stretching the hero past the fold now that the
 * plate is tall.
 *
 * The panel is not a landmark and the work's title is not a heading: the page
 * has one h1, and the record illustrates it rather than starting a section.
 * The image's alternate text is empty because the title and artist sit
 * directly beneath it.
 *
 * The content comes from one object in `content.ts`; changing the work is a
 * change to that object and its file alone.
 */
const RecordPanel: React.FC<{ record: LandingHeroRecord }> = ({ record }) => (
  <Paper
    shadow="none"
    radius={0}
    bg={LANDING_PALETTE.paper}
    p={0}
    style={{ border: LANDING_RULE }}
  >
    <img
      src={record.image.src}
      alt={record.image.alt}
      width={1080}
      height={1321}
      style={{ display: "block", width: "100%", height: "auto" }}
    />

    <Box p={{ base: "lg", md: "xl" }}>
      <Text ff="text" fz={{ base: "lg", sm: "xl" }} lh={1.2}>
        {record.title}
      </Text>
      <Text size="sm" c={LANDING_PALETTE.muted} mt="3xs">
        {record.artist}
      </Text>

      {/* `auto-fit` rather than a fixed two columns: the panel's own width
          decides, so the facts pair up beside the hero and fall to one column
          when the page is narrow, without a breakpoint to keep in step. */}
      <Box
        component="dl"
        mt="lg"
        mb={0}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          columnGap: "var(--mantine-spacing-lg)",
        }}
      >
        {record.fields.map((field) => (
          <Box
            key={field.label}
            component="div"
            py="xs"
            style={{ borderTop: LANDING_RULE }}
          >
            <Text component="dt" size="xs" c={LANDING_PALETTE.muted}>
              {field.label}
            </Text>
            <Text component="dd" size="sm" mt={2} mb={0}>
              {field.value}
            </Text>
          </Box>
        ))}
      </Box>

      <Text size="sm" c={LANDING_PALETTE.muted} mt="md">
        {record.caption}
      </Text>
    </Box>
  </Paper>
);

/**
 * The top of the landing page: the promise, the audience it is for, and the
 * page's only conversion path beside a real record.
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
              <Button
                component={Link}
                to={primary.href}
                size="md"
                color={LANDING_PALETTE.accent}
                autoContrast
              >
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
          <RecordPanel record={LANDING_HERO_RECORD} />
        </Grid.Col>
      </Grid>
    </LandingSection>
  );
};

export default HeroSection;
