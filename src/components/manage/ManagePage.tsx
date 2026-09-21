import React from 'react';
import { Container, Text, Button, Group, Card } from '@mantine/core';
import { Link } from 'react-router-dom';

const ManagePage: React.FC = () => {
  // This would normally fetch collections from the database
  const collections = [
    { id: '1', name: 'My First Collection' },
    { id: '2', name: 'Modern Art Collection' },
  ];

  return (
    <Container size="sm" style={{ paddingTop: '2rem', paddingBottom: '2rem' }}>
      <Group position="apart" mb="xl">
        <Text size="h2">My Collections</Text>
        <Button component={Link} to="/manage/collection/new">Create New Collection</Button>
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