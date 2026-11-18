import React from "react";
import { Button, Group } from "@mantine/core";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import AccountMenu from "./AccountMenu";
import HeaderBar from "./HeaderBar";

/**
 * The anonymous header: the shared bar with its wordmark leading home, and
 * either the account menu or the two doors into authentication.
 *
 * The public pages share it through `PublicLayout`, so a new public page
 * cannot ship without it. The signed-out side never links to the page the
 * visitor is already on — a Log in button on `/login` is a dead control.
 */
const PublicNavBar: React.FC = () => {
  const { currentUser } = useAuth();
  const { pathname } = useLocation();

  if (!currentUser) {
    return (
      <HeaderBar
        homePath="/"
        right={
          <Group gap="xs">
            {pathname !== "/login" ? (
              <Button variant="subtle" component={Link} to="/login">
                Log in
              </Button>
            ) : null}
            {pathname !== "/signup" ? (
              <Button component={Link} to="/signup">
                Sign up
              </Button>
            ) : null}
          </Group>
        }
      />
    );
  }

  return <HeaderBar homePath="/" right={<AccountMenu withManage />} />;
};

export default PublicNavBar;
