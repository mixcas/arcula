import React from "react";
import { Group, Button } from "@mantine/core";
import { Link } from "react-router-dom";
import AppTitle from "./AppTitle";

/**
 * Header for the unauthenticated landing page.
 *
 * The landing page has no account menu or sign-out, so this is deliberately
 * just the wordmark plus section anchors and a waitlist CTA — the anonymous
 * counterpart to ManageNavBar, which carries the same wordmark plus the user
 * menu. Vertical padding stands in for the fixed height ManageNavBar inherits
 * from the /manage header wrapper; the landing page has no such wrapper to
 * fill.
 */
const PublicNavBar: React.FC = () => (
  <Group px="md" py="sm" justify="space-between" wrap="wrap">
    <AppTitle component="h1" size="h1" />
    <Group gap="md" visibleFrom="sm">
      <Button variant="subtle" component={Link} to="/#simple" size="sm">
        Simple
      </Button>
      <Button variant="subtle" component={Link} to="/#catalogue" size="sm">
        Catalogue
      </Button>
      <Button variant="subtle" component={Link} to="/#publishing" size="sm">
        Publishing
      </Button>
      <Button variant="subtle" component={Link} to="/#roadmap" size="sm">
        Roadmap
      </Button>
      <Button variant="subtle" component={Link} to="/#faq" size="sm">
        FAQ
      </Button>
      <Button variant="subtle" component={Link} to="/login" size="sm">
        Login
      </Button>
      <Button component={Link} to="/#waitlist" size="sm">
        Join the waitlist
      </Button>
    </Group>
    <Group gap="sm" hiddenFrom="sm">
      <Button variant="subtle" component={Link} to="/login" size="xs">
        Login
      </Button>
      <Button component={Link} to="/#waitlist" size="xs">
        Join
      </Button>
    </Group>
  </Group>
);

export default PublicNavBar;
