import React from "react";
import { Group, Button, Menu, Avatar, Text } from "@mantine/core";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";

const ManageNavBar: React.FC = () => {
  const { currentUser, logout } = useAuth();

  const handleLogout = () => {
    try {
      void logout();
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return (
    <Group h="100%" px="md" justify="space-between">
      <Button variant="subtle" component={Link} to={`/manage`}>
        <Text size="lg" ff="heading" component="span">
          Custodia
        </Text>
      </Button>
      <Menu shadow="md" width={200}>
        <Menu.Target>
          <Button variant="subtle">
            <Avatar size="sm" radius="xl" />
            {currentUser?.email || "User"}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={handleLogout}>Logout</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
};

export default ManageNavBar;
