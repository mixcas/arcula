import React from "react";
import { AppShell, Container, ContainerProps } from "@mantine/core";
import ManageNavBar from "./ManageNavBar";

interface ManageLayoutProps {
  children: React.ReactNode;
  containerProps?: ContainerProps;
}

const ManageLayout: React.FC<ManageLayoutProps> = ({
  children,
  containerProps,
}) => {
  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <ManageNavBar />
      </AppShell.Header>
      <AppShell.Main>
        <Container {...containerProps}>{children}</Container>
      </AppShell.Main>
    </AppShell>
  );
};

export default ManageLayout;
