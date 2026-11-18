import React from "react";
import { Outlet } from "react-router-dom";
import AppShellLayout from "./AppShellLayout";
import PublicNavBar from "./PublicNavBar";

/**
 * The anonymous shell: the app frame with the public header, wrapping every
 * public page through one pathless route in `App.tsx`.
 *
 * Because the route group owns the header and the content column, a new
 * public page cannot ship without them; the pages themselves start at their
 * content and never repeat the frame.
 */
const PublicLayout: React.FC = () => (
  <AppShellLayout header={<PublicNavBar />} containerProps={{ size: "sm" }}>
    <Outlet />
  </AppShellLayout>
);

export default PublicLayout;
