import React from "react";
import { Button, Group } from "@mantine/core";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { returnStateFor } from "@/utils/returnPath";
import AccountMenu from "./AccountMenu";
import HeaderBar from "./HeaderBar";

interface PublicNavBarProps {
  /**
   * The bar's surface, passed through from `PublicLayout`. Defaults to the
   * app's grey; the home route asks for the landing page's paper.
   */
  background?: string;
}

/**
 * The anonymous header: the shared bar with its wordmark leading home, and
 * either the account menu or the two doors into authentication.
 *
 * The public pages share it through `PublicLayout`, so a new public page
 * cannot ship without it. The signed-out side never links to the page the
 * visitor is already on — a Log in button on `/login` is a dead control.
 *
 * The doors carry no return path from an ordinary public page: arriving
 * signed out from `/` and authenticating lands on the dashboard, as the
 * landing page's own Log in button always has. An invitation is the one page
 * that puts itself in router state, so a visitor who uses the header instead
 * of the invitation card's own doors does not lose the link they were sent.
 */
const PublicNavBar: React.FC<PublicNavBarProps> = ({ background }) => {
  const { currentUser } = useAuth();
  const { pathname } = useLocation();

  if (!currentUser) {
    const returnState = pathname.startsWith("/invite/")
      ? returnStateFor(pathname)
      : undefined;

    return (
      <HeaderBar
        homePath="/"
        background={background}
        right={
          <Group gap="xs">
            {pathname !== "/login" ? (
              <Button
                variant="subtle"
                component={Link}
                to="/login"
                state={returnState}
              >
                Log in
              </Button>
            ) : null}
            {pathname !== "/signup" ? (
              <Button component={Link} to="/signup" state={returnState}>
                Sign up
              </Button>
            ) : null}
          </Group>
        }
      />
    );
  }

  return (
    <HeaderBar
      homePath="/"
      background={background}
      right={<AccountMenu withManage />}
    />
  );
};

export default PublicNavBar;
