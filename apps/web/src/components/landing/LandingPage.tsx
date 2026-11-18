import React from "react";
import { Box } from "@mantine/core";
import AgentBand from "./AgentBand";
import CataloguesSection from "./CataloguesSection";
import { LANDING_METADATA } from "./content";
import FeaturesSection from "./FeaturesSection";
import FinalAction from "./FinalAction";
import GettingStartedSection from "./GettingStartedSection";
import HeroSection from "./HeroSection";
import { LANDING_PALETTE } from "./palette";
import QuestionsSection from "./QuestionsSection";
import RecordSection from "./RecordSection";
import SiteFooter from "./SiteFooter";

/**
 * The public home page: what Arcula is, who it is for, and how to start.
 *
 * The page is the shell only: it places the sections in reading order and owns
 * nothing else. Every section is a band with its own surface, container and
 * rhythm, their copy lives in `content.ts`, and the page's own head metadata
 * is declared here so it unmounts with the route. The order is the argument —
 * the promise and an example, what a record holds, the three kinds, how to
 * begin, what the product does, the agent band, the questions, one last ask
 * and the footer.
 *
 * The head metadata is rendered here rather than written to `document.head`
 * in an effect: React 19 hoists `<title>` and `<meta>` from the component tree
 * into `<head>`, so the page's title and Open Graph tags unmount with the
 * route. No image is declared because none exists.
 */
const LandingPage: React.FC = () => (
  <Box bg={LANDING_PALETTE.paper}>
    <title>{LANDING_METADATA.title}</title>
    <meta name="description" content={LANDING_METADATA.description} />
    <meta property="og:title" content={LANDING_METADATA.title} />
    <meta property="og:description" content={LANDING_METADATA.description} />
    <meta property="og:url" content={LANDING_METADATA.url} />
    <meta property="og:type" content={LANDING_METADATA.type} />

    <HeroSection />
    <RecordSection />

    <CataloguesSection />
    <GettingStartedSection />

    <FeaturesSection />
    <AgentBand />

    <QuestionsSection />
    <FinalAction />
    <SiteFooter />
  </Box>
);

export default LandingPage;
