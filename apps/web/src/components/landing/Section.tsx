import React from "react";
import { Box, Container, Divider, Text, Title } from "@mantine/core";
import type { TitleOrder } from "@mantine/core";
import { APP_HEADER_HEIGHT } from "@/components/layout/HeaderBar";
import { LANDING_PALETTE } from "./palette";

interface LandingSectionProps {
  children: React.ReactNode;
  /** The anchor a same-page link targets, e.g. `LANDING_ANCHORS.whatItDoes`. */
  id?: string;
  /** The full-bleed band's surface. Defaults to the landing paper. */
  background?: string;
  /** The copy on that surface, since a dark band inverts the pair. */
  color?: string;
  /**
   * Draw the hairline that separates one section from the last. The hero,
   * which follows the header rather than a section, passes `false`.
   */
  divided?: boolean;
}

/**
 * One landing section: a full-bleed band with its own surface, an `xl`
 * container and the page's vertical rhythm.
 *
 * The band, not the page, owns the gutters and the rule, so every section is
 * the same width and the same distance from its neighbours however its body is
 * composed. It is presentation only: the heading is a separate primitive so a
 * section can seat it inside a column, and the copy never lives here.
 *
 * The anchor id sits on the band rather than on the heading, and carries a
 * scroll margin for the fixed header, so a same-page jump does not land with
 * the heading under the bar.
 */
const LandingSection: React.FC<LandingSectionProps> = ({
  children,
  id,
  background = LANDING_PALETTE.paper,
  color = LANDING_PALETTE.ink,
  divided = true,
}) => (
  <Box
    component="section"
    id={id}
    bg={background}
    c={color}
    py={{ base: "2xl", md: 72 }}
    style={{ scrollMarginTop: APP_HEADER_HEIGHT + 16 }}
  >
    <Container size="xl" px={{ base: "md", md: "xl" }}>
      {divided ? <Divider color={LANDING_PALETTE.rule} /> : null}
      <Box mt={divided ? { base: "lg", md: "xl" } : 0}>{children}</Box>
    </Container>
  </Box>
);

interface LandingSectionHeadingProps {
  /** The small label above the heading, e.g. `01 — The record`. */
  label?: string;
  heading: string;
  /** The hero's heading is the page's only h1; every section below is an h2. */
  order?: Extract<TitleOrder, 1 | 2>;
}

/**
 * The landing page's heading block: an optional numbered label over the
 * display heading.
 *
 * Separate from the band because the hero sets its heading inside its left
 * column while the sections after it set theirs across the page. Both share
 * one type scale and one label treatment, so a new section cannot invent a
 * third.
 */
export const LandingSectionHeading: React.FC<LandingSectionHeadingProps> = ({
  label,
  heading,
  order = 2,
}) => (
  <Box>
    {label ? (
      <Text size="sm" c={LANDING_PALETTE.muted} mb="2xs">
        {label}
      </Text>
    ) : null}
    <Title
      order={order}
      lh={order === 1 ? 1.1 : 1.2}
      maw={order === 1 ? 760 : 720}
      fz={
        order === 1
          ? { base: "3xl", sm: "4xl", md: "5xl" }
          : { base: "2xl", md: "4xl" }
      }
    >
      {heading}
    </Title>
  </Box>
);

export default LandingSection;
