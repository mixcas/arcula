import React from "react";
import { Anchor, Button, Group, Stack, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { LANDING_FINAL_ACTION } from "./content";
import { LANDING_PALETTE } from "./palette";
import LandingSection, { LandingSectionHeading } from "./Section";

/**
 * The page's closing action: one catalogue, with the way to start it.
 *
 * The heading is the section's `h2` and carries no number, because the page's
 * numbered argument ended at the questions. The primary action follows the
 * session — signed out it creates, signed in it opens the dashboard — and the
 * login door exists only when there is no session, so a signed-in reader is
 * never offered a sign-up or a redundant login.
 */
const FinalAction: React.FC = () => {
  const { currentUser } = useAuth();
  const { actions } = LANDING_FINAL_ACTION;

  return (
    <LandingSection>
      <Stack gap="lg" align="flex-start">
        <LandingSectionHeading heading={LANDING_FINAL_ACTION.heading} />
        <Text fz={{ base: "lg", md: "xl" }} lh={1.45} maw={560}>
          {LANDING_FINAL_ACTION.body}
        </Text>
        <Group gap="lg" wrap="wrap">
          {currentUser ? (
            <Button
              component={Link}
              to={actions.signedIn.primary.href}
              size="md"
              color="orange.5"
              autoContrast
            >
              {actions.signedIn.primary.label}
            </Button>
          ) : (
            <>
              <Button
                component={Link}
                to={actions.signedOut.primary.href}
                size="md"
                color="orange.5"
                autoContrast
              >
                {actions.signedOut.primary.label}
              </Button>
              <Anchor
                component={Link}
                to={actions.signedOut.secondary.href}
                size="md"
                c={LANDING_PALETTE.ink}
                underline="always"
              >
                {actions.signedOut.secondary.label}
              </Anchor>
            </>
          )}
        </Group>
      </Stack>
    </LandingSection>
  );
};

export default FinalAction;
