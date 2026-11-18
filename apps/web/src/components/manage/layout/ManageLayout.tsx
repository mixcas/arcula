import React from "react";
import { ContainerProps } from "@mantine/core";
import AppShellLayout from "@/components/layout/AppShellLayout";
import ManageNavBar from "./ManageNavBar";

interface ManageLayoutProps {
  children: React.ReactNode;
  containerProps?: ContainerProps;
  /**
   * What the fixed header shows. Defaults to the manage nav bar, so every
   * `/manage` page is unchanged; a page themed as the app but branded
   * differently (the Catalogue PDF viewer) passes its own bar instead of
   * defining a second shell.
   */
  header?: React.ReactNode;
}

/**
 * The authenticated shell.
 *
 * Every frame rule — the header height, the main offset, the content
 * container — belongs to `AppShellLayout`; this is the thin instantiation
 * that gives it the manage header when a page does not bring its own.
 */
const ManageLayout: React.FC<ManageLayoutProps> = ({
  children,
  containerProps,
  header,
}) => {
  return (
    <AppShellLayout
      header={header ?? <ManageNavBar />}
      containerProps={containerProps}
    >
      {children}
    </AppShellLayout>
  );
};

export default ManageLayout;
