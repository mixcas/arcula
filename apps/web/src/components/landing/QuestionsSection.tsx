import React from "react";
import { Box, Text } from "@mantine/core";
import { LANDING_QUESTIONS } from "./content";
import { LANDING_PALETTE, LANDING_RULE } from "./palette";
import LandingSection, { LandingSectionHeading } from "./Section";

/**
 * The page's questions: six settled answers, read as a definition list rather
 * than as a stack of toggles.
 *
 * A question is a term and its answer is the description, so the list says
 * what each pair is without a heading: the six questions are not `h2`s and not
 * `h3`s, and the page keeps one `h2` for this section. Nothing is hidden
 * behind a disclosure — the answers are the section's value, and a reader
 * scanning the page should meet them, not six closed rows.
 *
 * Each pair is separated by the same hairline the record and the features
 * use, and the answer is capped at a readable measure. The set is closed in
 * `content.ts`: no item is invented here, and the export answer is allowed to
 * say what is not built.
 */
const QuestionsSection: React.FC = () => (
  <LandingSection>
    <LandingSectionHeading
      label={LANDING_QUESTIONS.label}
      heading={LANDING_QUESTIONS.heading}
    />

    {/* The space under the heading is `mt` alone: Mantine applies a
        non-responsive style prop like `m={0}` inline, which would beat the
        responsive `mt` class and collapse the gap. The other sides are reset
        with their own longhands instead. */}
    <Box component="dl" mt={{ base: "xl", md: 48 }} mb={0} maw={820}>
      {LANDING_QUESTIONS.items.map((item) => (
        <Box
          key={item.question}
          component="div"
          py={{ base: "md", md: "lg" }}
          style={{ borderTop: LANDING_RULE }}
        >
          <Text component="dt" fz={{ base: "md", md: "lg" }} fw={600} lh={1.3}>
            {item.question}
          </Text>
          <Text
            component="dd"
            mt="2xs"
            mb={0}
            c={LANDING_PALETTE.muted}
            lh={1.5}
            maw={640}
          >
            {item.answer}
          </Text>
        </Box>
      ))}
    </Box>
  </LandingSection>
);

export default QuestionsSection;
