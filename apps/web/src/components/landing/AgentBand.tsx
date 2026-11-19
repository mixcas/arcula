import React from "react";
import { Box, Group } from "@mantine/core";
import { LANDING_AGENT_BAND, type LandingAgentMark } from "./content";
import { LANDING_PALETTE } from "./palette";
import LandingSection, { LandingSectionHeading } from "./Section";

/**
 * One client's mark, drawn as a paper silhouette.
 *
 * The files are single-colour SVGs whose own fills — black for most, the
 * Claude orange — would disappear or clash on the ink band, so the shape is
 * used as a mask and the paper colour paints it. That keeps one band contrast
 * for all three and means a new client needs no recoloured asset.
 *
 * It is an image, not a link: the band names the option and offers nothing to
 * click. The label is the client's name, so a screen reader hears which
 * clients the product talks to.
 */
const AgentMark: React.FC<{ mark: LandingAgentMark }> = ({ mark }) => (
  <Box
    role="img"
    aria-label={mark.label}
    h={28}
    w={28}
    style={{
      backgroundColor: LANDING_PALETTE.paper,
      WebkitMaskImage: `url(${mark.src})`,
      maskImage: `url(${mark.src})`,
      WebkitMaskRepeat: "no-repeat",
      maskRepeat: "no-repeat",
      WebkitMaskPosition: "center",
      maskPosition: "center",
      WebkitMaskSize: "contain",
      maskSize: "contain",
    }}
  />
);

/**
 * Agent access: one sentence on ink, with the clients' marks beside it.
 *
 * The band is the page's only dark surface, and that is the whole device: no
 * label, no link, no endpoint, no tool list and no protocol note. The section
 * heading is the sentence itself, so a screen reader hears it as one statement
 * about the product rather than as a subsection of the capabilities above.
 *
 * The marks sit to the sentence's right on a wide screen and drop below it on
 * a narrow one, so the sentence keeps its measure and the row never forces a
 * horizontal scroll.
 *
 * The palette's ink and paper are passed explicitly as the band's background
 * and copy, rather than adding an inverted pair to `LANDING_PALETTE`: the two
 * values already exist, and this is the only place that swaps them. The pair
 * is the brand's own, paper on ink, so the contrast is the same one the rest
 * of the page relies on — the marks included.
 */
const AgentBand: React.FC = () => (
  <LandingSection
    background={LANDING_PALETTE.ink}
    color={LANDING_PALETTE.paper}
  >
    <Group justify="space-between" align="center" gap="xl" wrap="wrap">
      <Box style={{ flex: "1 1 420px", minWidth: 0 }}>
        <LandingSectionHeading heading={LANDING_AGENT_BAND.statement} />
      </Box>
      <Group gap="xl" align="center" wrap="nowrap">
        {LANDING_AGENT_BAND.marks.map((mark) => (
          <AgentMark key={mark.label} mark={mark} />
        ))}
      </Group>
    </Group>
  </LandingSection>
);

export default AgentBand;
