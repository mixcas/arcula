import React from 'react';
import { AppShell, Group, Button, Menu, Avatar } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { signOut } from 'firebase/auth';
import { auth } from '../../../services/firebase';

interface ManageLayoutProps {
  children: React.ReactNode;
}

const ManageLayout: React.FC<ManageLayoutProps> = ({ children }) => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <AppShell
      header={{ height: 60 }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md">
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
      </AppShell.Header>
      <AppShell.Main>
        {children}
      </AppShell.Main>
    </AppShell>
  );
};

export default ManageLayout;