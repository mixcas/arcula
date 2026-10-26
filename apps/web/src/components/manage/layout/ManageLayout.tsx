import React from "react";
import { AppShell, Container, ContainerProps } from "@mantine/core";
import ManageNavBar from "./ManageNavBar";

/**
 * The authenticated shell's header height, in pixels.
 *
 * Exported because it is not the layout's private business: whatever renders
 * in the header sits in it, and a body that fills the window under it — the
 * Collection PDF viewer's preview — sizes against the same number rather than
 * writing 60 a second time.
 */
export const MANAGE_HEADER_HEIGHT = 60;

interface ManageLayoutProps {
  children: React.ReactNode;
  containerProps?: ContainerProps;
  /**
   * What the fixed header shows. Defaults to the manage nav bar, so every
   * `/manage` page is unchanged; a page themed as the app but branded
   * differently (the Collection PDF viewer) passes its own bar instead of
   * defining a second shell.
   */
  header?: React.ReactNode;
}

const ManageLayout: React.FC<ManageLayoutProps> = ({
  children,
  containerProps,
  header,
}) => {
  return (
    <AppShell header={{ height: MANAGE_HEADER_HEIGHT }} padding="md">
      <AppShell.Header>{header ?? <ManageNavBar />}</AppShell.Header>
      <AppShell.Main>
        <Container {...containerProps}>{children}</Container>
      </AppShell.Main>
    </AppShell>
  );
};

export default ManageLayout;
