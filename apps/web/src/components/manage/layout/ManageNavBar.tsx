import React from "react";
import AccountMenu from "@/components/layout/AccountMenu";
import HeaderBar from "@/components/layout/HeaderBar";

/**
 * The authenticated header: the shared bar with its wordmark leading to the
 * dashboard, and the shared account menu.
 *
 * No Manage item: on `/manage` the wordmark is already the way there, so a
 * menu item to the current page would be a dead control.
 */
const ManageNavBar: React.FC = () => (
  <HeaderBar homePath="/manage" right={<AccountMenu />} />
);

export default ManageNavBar;
