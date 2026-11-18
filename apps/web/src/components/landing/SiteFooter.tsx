import React from "react";
import { Anchor, Box, Container, Group, Stack, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import { LANDING_FOOTER } from "./content";
import { LANDING_PALETTE } from "./palette";

/**
 * The landing page's footer: the product's name and line, then the three ways
 * a reader can act on them.
 *
 * It is its own full-bleed `footer` landmark on paper rather than a
 * `LandingSection`, because it is the page's closing chrome and not another
 * numbered argument. It lives here rather than in `PublicLayout`: the auth
 * pages share that layout, and the spec keeps them unchanged. GitHub is the
 * page's only outbound link and opens in a new tab with `noopener`; the
 * address is a `mailto:`, so a question needs no form.
 */
const SiteFooter: React.FC = () => (
  <Box
    component="footer"
    bg={LANDING_PALETTE.paper}
    c={LANDING_PALETTE.ink}
    py={{ base: "xl", md: 48 }}
  >
    <Container size="xl" px={{ base: "md", md: "xl" }}>
      <Box
        pt={{ base: "lg", md: "xl" }}
        style={{ borderTop: `1px solid ${LANDING_PALETTE.rule}` }}
      >
        <Group justify="space-between" align="flex-start" gap="lg">
          <Stack gap="2xs">
            <Text ff="heading" fz="lg">
              {LANDING_FOOTER.name}
            </Text>
            <Text size="sm" c={LANDING_PALETTE.muted} maw={360}>
              {LANDING_FOOTER.tagline}
            </Text>
          </Stack>

          <Group gap="lg" wrap="wrap">
            <Anchor
              href={LANDING_FOOTER.github.href}
              target="_blank"
              rel="noopener noreferrer"
              size="sm"
              c={LANDING_PALETTE.ink}
              underline="always"
            >
              {LANDING_FOOTER.github.label}
            </Anchor>
            <Anchor
              component={Link}
              to={LANDING_FOOTER.login.href}
              size="sm"
              c={LANDING_PALETTE.ink}
              underline="always"
            >
              {LANDING_FOOTER.login.label}
            </Anchor>
            <Anchor
              href={LANDING_FOOTER.contact.href}
              size="sm"
              c={LANDING_PALETTE.ink}
              underline="always"
            >
              {LANDING_FOOTER.contact.label}
            </Anchor>
          </Group>
        </Group>

        <Text size="xs" c={LANDING_PALETTE.muted} mt="xl">
          {LANDING_FOOTER.copyright}
        </Text>
      </Box>
    </Container>
  </Box>
);

export default SiteFooter;
