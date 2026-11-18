import React from "react";
import { LANDING_AGENT_BAND } from "./content";
import { LANDING_PALETTE } from "./palette";
import LandingSection, { LandingSectionHeading } from "./Section";

/**
 * Agent access: one sentence, inverted onto ink.
 *
 * The band is the page's only dark surface, and that is the whole device: no
 * label, no link, no endpoint, no tool list and no protocol note. The section
 * heading is the sentence itself, so a screen reader hears it as one statement
 * about the product rather than as a subsection of the capabilities above.
 *
 * The palette's ink and paper are passed explicitly as the band's background
 * and copy, rather than adding an inverted pair to `LANDING_PALETTE`: the two
 * values already exist, and this is the only place that swaps them. The pair
 * is the brand's own, paper on ink, so the contrast is the same one the rest
 * of the page relies on.
 */
const AgentBand: React.FC = () => (
  <LandingSection
    background={LANDING_PALETTE.ink}
    color={LANDING_PALETTE.paper}
  >
    <LandingSectionHeading heading={LANDING_AGENT_BAND.statement} />
  </LandingSection>
);

export default AgentBand;
