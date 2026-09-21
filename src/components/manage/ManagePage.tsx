import React from 'react';
import { Container, Text, Button, Group, Card, Menu, Avatar } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { signOut } from 'firebase/auth';

const ManagePage: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  
  // This would normally fetch collections from the database
  const collections = [
    { id: '1', name: 'My First Collection' },
    { id: '2', name: 'Modern Art Collection' },
  ];

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <Container size="sm" style={{ paddingTop: '2rem', paddingBottom: '2rem' }}>
      <Group position="apart" mb="xl">
        <Text size="h2">My Collections</Text>
        <Group>
          <Menu shadow="md" width={200}>
            <Menu.Target>
              <Button variant="subtle">
                <Avatar size="sm" radius="xl" />
                {currentUser?.email || 'User'}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={handleLogout}>Logout</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {collections.length === 0 ? (
        <Text align="center">No collections yet. Create your first collection!</Text>
      ) : (
        <div>
          {collections.map((collection) => (
            <Card key={collection.id} shadow="sm" p="lg" mb="md">
              <Group position="apart">
                <Text size="h3">{collection.name}</Text>
                <Button component={Link} to={`/manage/collection/${collection.id}`}>View</Button>
              </Group>
            </Card>
          ))}
        </div>
      )}
    </Container>
  );
};

export default ManagePage;