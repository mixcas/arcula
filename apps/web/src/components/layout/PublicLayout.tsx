import React from "react";
import { Outlet } from "react-router-dom";
import type { AppShellProps, ContainerProps } from "@mantine/core";
import AppShellLayout from "./AppShellLayout";
import PublicNavBar from "./PublicNavBar";

interface PublicLayoutProps {
  /**
   * The content container's Mantine props. Defaults to the narrow `sm` column
   * the auth pages are composed for; the home route asks for a fluid one.
   */
  containerProps?: ContainerProps;
  /**
   * The padding around the main area. Defaults to the shell's `md`; the home
   * route passes `0` so its sections reach the window's edge.
   */
  padding?: AppShellProps["padding"];
  /**
   * The header bar's surface. Defaults to the app's grey; the home route asks
   * for the landing page's paper.
   */
  headerBackground?: string;
}

/**
 * The anonymous shell: the app frame with the public header, wrapping every
 * public page through one pathless route in `App.tsx`.
 *
 * Because the route group owns the header and the content column, a new
 * public page cannot ship without them; the pages themselves start at their
 * content and never repeat the frame. The two route groups differ only in the
 * frame they ask for — the auth pages' narrow column, or the home page's
 * full-bleed surface — never in whether the header is there.
 */
const PublicLayout: React.FC<PublicLayoutProps> = ({
  containerProps = { size: "sm" },
  padding,
  headerBackground,
}) => (
  <AppShellLayout
    header={<PublicNavBar background={headerBackground} />}
    containerProps={containerProps}
    padding={padding}
  >
    <Outlet />
  </AppShellLayout>
);

export default PublicLayout;
