import React from "react";
import { Group, Button, Menu, Avatar, Text } from "@mantine/core";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import AppTitle from "@/components/AppTitle";

const ManageNavBar: React.FC = () => {
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
    <Group h="100%" px="md" justify="space-between">
      <Button variant="subtle" component={Link} to={`/manage`}>
        <AppTitle />
      </Button>
      <Menu shadow="md" width={220}>
        <Menu.Target>
          <Button variant="transparent">
            <Group gap="xs">
              <Avatar size="sm" radius="xl">
                {initial}
              </Avatar>
              <Text size="sm">{label}</Text>
            </Group>
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item component={Link} to="/manage/profile">
            Profile
          </Menu.Item>
          <Menu.Item onClick={handleLogout}>Logout</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
};

export default ManageNavBar;
