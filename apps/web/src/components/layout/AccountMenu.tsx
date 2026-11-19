import React from "react";
import { Avatar, Button, Group, Menu, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

interface AccountMenuProps {
  /**
   * Adds Manage to the menu. A public header wants it, because its wordmark
   * leads home; the manage header does not, because there the wordmark already
   * reaches the dashboard and an item to the current page is a dead control.
   */
  withManage?: boolean;
}

/**
 * The signed-in account control: the avatar and name that open Account,
 * optionally Manage, and Log out.
 *
 * It lives outside either header because both sides of sign-in show the same
 * account, and the label's fallback chain is load-bearing: a change here must
 * apply everywhere the account appears.
 */
const AccountMenu: React.FC<AccountMenuProps> = ({ withManage = false }) => {
  const { logout, me, currentUser } = useAuth();

  const handleLogout = () => {
    try {
      void logout();
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  // The label's fallback chain: first + last name (the profile), then the
  // session's core name — the seeded account has `name` but no first/last
  // yet — then the email. The menu never renders an empty label, and while
  // /me is in flight the session-side half is already available.
  const fromProfile = me
    ? [me.firstName, me.lastName].filter(Boolean).join(" ").trim()
    : "";
  const label =
    fromProfile ||
    (currentUser?.displayName ?? "").trim() ||
    currentUser?.email ||
    "";
  const initial = label.charAt(0).toUpperCase() || "?";

  return (
    <Menu shadow="md" width={220}>
      <Menu.Target>
        {/* Below `md` (phones and portrait tablets) the label is hidden by the
            breakpoint and the avatar initial is the whole trigger, so the
            button carries the full name as its accessible name — otherwise
            a screen reader would announce a single letter. */}
        <Button
          variant="transparent"
          aria-label={label ? `${label} — account menu` : "Account menu"}
        >
          <Group gap="xs">
            <Avatar size="sm" radius="xl">
              {initial}
            </Avatar>
            <Text size="sm" visibleFrom="md">
              {label}
            </Text>
          </Group>
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item component={Link} to="/manage/profile">
          Account
        </Menu.Item>
        {withManage ? (
          <Menu.Item component={Link} to="/manage">
            Manage
          </Menu.Item>
        ) : null}
        <Menu.Item onClick={handleLogout}>Log out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
};

export default AccountMenu;
