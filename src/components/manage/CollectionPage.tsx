import React, { useState } from 'react';
import { Container, Text, Button, Group, Card, Switch, Divider } from '@mantine/core';
import { Link, useParams } from 'react-router-dom';

const CollectionPage: React.FC = () => {
  const { collectionId } = useParams<{ collectionId: string }>();
  const [isPublic, setIsPublic] = useState(false);
  
  // This would normally fetch collection data from the database
  const collection = {
    id: collectionId,
    name: 'My First Collection',
    isPublic: false,
  };

  // This would normally fetch artworks from the database
  const artworks = [
    { id: '1', title: 'Starry Night', artistName: 'Vincent van Gogh', date: '1889' },
    { id: '2', title: 'Mona Lisa', artistName: 'Leonardo da Vinci', date: '1503' },
  ];

  const handleTogglePublic = () => {
    setIsPublic(!isPublic);
    // Logic to update collection privacy would go here
  };

  return (
    <Container size="sm" style={{ paddingTop: '2rem', paddingBottom: '2rem' }}>
      <Group position="apart" mb="xl">
        <Text size="h2">{collection.name}</Text>
        <Button component={Link} to={`/manage/collection/${collectionId}/settings`}>Settings</Button>
      </Group>

      <Card shadow="sm" p="lg" mb="md">
        <Group position="apart">
          <Text>Public Collection</Text>
          <Switch 
            checked={isPublic} 
            onChange={handleTogglePublic}
            label="Make public"
          />
        </Group>
        
        <Divider mt="md" mb="md" />
        
        <Group position="center" mb="md">
          <Button component={Link} to={`/manage/collection/${collectionId}/artwork/add`}>Add Artwork</Button>
        </Group>
      </Card>

      {artworks.length === 0 ? (
        <Text align="center">No artworks in this collection yet.</Text>
      ) : (
        <div>
          {artworks.map((artwork) => (
            <Card key={artwork.id} shadow="sm" p="lg" mb="md">
              <Group position="apart">
                <div>
                  <Text size="h3">{artwork.title}</Text>
                  <Text>{artwork.artistName}</Text>
                  <Text>{artwork.date}</Text>
                </div>
                <Button component={Link} to={`/manage/collection/${collectionId}/artwork/${artwork.id}`}>Edit</Button>
              </Group>
            </Card>
          ))}
        </div>
      )}
    </Container>
  );
};

export default CollectionPage;