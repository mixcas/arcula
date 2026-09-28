import React from "react";
import { Group } from "@mantine/core";
import AppTitle from "./AppTitle";

/**
 * Title-only header for the unauthenticated landing page.
 *
 * The landing page has no account menu or sign-out, so this is deliberately
 * just the wordmark — the anonymous counterpart to ManageNavBar, which carries
 * the same wordmark plus the user menu. Vertical padding stands in for the
 * fixed height ManageNavBar inherits from the /manage header wrapper; the
 * landing page has no such wrapper to fill.
 */
const PublicNavBar: React.FC = () => (
  <Group px="md" py="sm">
    <AppTitle component="h1" size="h1" />
  </Group>
);

export default PublicNavBar;
