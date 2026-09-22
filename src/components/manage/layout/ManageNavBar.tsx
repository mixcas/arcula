import React from 'react';
import { Group, Button, Menu, Avatar, Text } from '@mantine/core';
import { useAuth } from '../../../context/AuthContext';
import { signOut } from 'firebase/auth';
import { auth } from '../../../services/firebase';
import { useNavigate } from 'react-router-dom';

const ManageNavBar: React.FC = () => {
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
    <Group h="100%" px="md" justify='space-between'>
      <Text size='lg'>Custodia</Text>
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