import React from "react";
import { Button, Group } from "@mantine/core";
import { Link } from "react-router-dom";
import AppTitle from "@/components/AppTitle";

/**
 * The app header's height, in pixels.
 *
 * Exported because it is not the bar's private business: whatever renders in
 * the bar sits in it, and a body that fills the window under it — the Catalogue
 * PDF viewer's preview — sizes against the same number rather than writing 60 a
 * second time.
 */
export const APP_HEADER_HEIGHT = 60;

interface HeaderBarProps {
  /**
   * Where the wordmark leads. The public chrome sends a visitor home; the
   * authenticated chrome sends an account holder to the dashboard.
   */
  homePath: string;
  /** What sits at the far end of the bar: the account control, or its signed-out counterpart. */
  right?: React.ReactNode;
  /**
   * The bar's surface. Defaults to the app's grey; the home route asks for the
   * landing page's paper so its header reads as part of that page.
   */
  background?: string;
}

/**
 * The app's one header bar.
 *
 * It owns the shape both shells render — a row that fills the shell's header
 * slot, the wordmark on the left, a right-hand slot — so the public header and
 * the manage header cannot drift apart. What fills the slot is the caller's:
 * a shell passes its account control, and a page keeps its own branded bar.
 */
const HeaderBar: React.FC<HeaderBarProps> = ({
  homePath,
  right,
  background = "gray.1",
}) => (
  <Group h="100%" px="md" justify="space-between" bg={background}>
    <Button variant="subtle" component={Link} to={homePath}>
      <AppTitle />
    </Button>
    {right}
  </Group>
);

export default HeaderBar;
