import React from "react";
import { AppShell, Container } from "@mantine/core";
import type { AppShellProps, ContainerProps } from "@mantine/core";
import { APP_HEADER_HEIGHT } from "./HeaderBar";

interface AppShellLayoutProps {
  children: React.ReactNode;
  /**
   * What the fixed header shows. Required rather than defaulted: every shell
   * in the app has a header, and the slot is what a branded page — the
   * Catalogue PDF viewer — substitutes its own bar for.
   */
  header: React.ReactNode;
  /** The content column's Mantine props, when a page needs another measure. */
  containerProps?: ContainerProps;
  /**
   * The padding around the main area. Defaults to the app's `md`; a full-bleed
   * page passes `0` so its own sections can reach the window's edge.
   */
  padding?: AppShellProps["padding"];
}

/**
 * The app's one page frame: the fixed header slot, the main area below it and
 * the content container inside it.
 *
 * Both shells instantiate this — the manage layout with its authenticated
 * header, the public layout with the anonymous one — so the offset, the
 * padding and the container are defined once instead of per page.
 */
const AppShellLayout: React.FC<AppShellLayoutProps> = ({
  children,
  header,
  containerProps,
  padding = "md",
}) => {
  return (
    <AppShell header={{ height: APP_HEADER_HEIGHT }} padding={padding}>
      <AppShell.Header>{header}</AppShell.Header>
      <AppShell.Main>
        <Container {...containerProps}>{children}</Container>
      </AppShell.Main>
    </AppShell>
  );
};

export default AppShellLayout;
