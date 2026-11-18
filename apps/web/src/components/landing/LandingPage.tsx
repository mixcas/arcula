import React from "react";
import { Box } from "@mantine/core";
import CataloguesSection from "./CataloguesSection";
import { LANDING_METADATA } from "./content";
import GettingStartedSection from "./GettingStartedSection";
import HeroSection from "./HeroSection";
import { LANDING_PALETTE } from "./palette";

/**
 * The public home page: what Arcula is, who it is for, and how to start.
 *
 * The page is the shell only. The hero is the first section, and the sections
 * after it are added at the marked insertion point below by their own tickets;
 * their copy lives in `content.ts`. The bands own the width and the rhythm, so
 * this file never lays a section out.
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

    {/*
      The page's sections, in reading order. Each later ticket adds its own
      section at this point and nowhere else, as
      `<LandingSection id={…}><LandingSectionHeading label=… heading=… />…</LandingSection>`:

        01 — The record
        02 — The catalogues
        03 — Getting started
        04 — What it does        (carries id={LANDING_ANCHORS.whatItDoes})
        the agent band           (unnumbered, no label, dark surface)
        05 — Questions
        the final action
        the footer

      Copy and anchors belong in `content.ts`: append the section's block there,
      and if it is a link target add its id to `LANDING_ANCHORS` so the link and
      the section read the same constant.
    */}

    <CataloguesSection />
    <GettingStartedSection />
  </Box>
);

export default LandingPage;
