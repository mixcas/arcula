import React, { useState, useEffect } from 'react';
import { Container, Text, Button, Group, Card, Switch, Divider } from '@mantine/core';
import { Link, useParams } from 'react-router-dom';
import { collectionService } from '../../services/collectionService';
import { artworkService } from '../../services/artworkService';

const CollectionPage: React.FC = () => {
  const { collectionId } = useParams<{ collectionId: string }>();
  const [collection, setCollection] = useState<any>(null);
  const [artworks, setArtworks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCollectionData = async () => {
      if (!collectionId) return;
      
      try {
        // Fetch the collection
        const fetchedCollection = await collectionService.getCollection(collectionId);
        if (!fetchedCollection) {
          setError('Collection not found');
          setLoading(false);
          return;
        }
        
        setCollection(fetchedCollection);
        
        // Fetch artworks for this collection
        const fetchedArtworks = await artworkService.getCollectionArtworks(collectionId);
        setArtworks(fetchedArtworks);
        
        setLoading(false);
      } catch (err) {
        console.error('Error fetching collection data:', err);
        setError('Failed to fetch collection data');
        setLoading(false);
      }
    };

    fetchCollectionData();
  }, [collectionId]);

  const handleTogglePublic = async () => {
    if (!collection) return;
    
    try {
      // Update the collection privacy in Firestore
      await collectionService.updateCollection(collection.id, { 
        isPublic: !collection.isPublic 
      });
      
      // Update local state
      setCollection({ ...collection, isPublic: !collection.isPublic });
    } catch (err) {
      console.error('Error updating collection privacy:', err);
      // Optionally show an error message to the user
    }
  };

  if (loading) {
    return (
      <Container size="sm" style={{ paddingTop: '2rem', paddingBottom: '2rem' }}>
        <Text>Loading collection...</Text>
      </Container>
    );
  }

  if (error) {
    return (
      <Container size="sm" style={{ paddingTop: '2rem', paddingBottom: '2rem' }}>
        <Text color="red">{error}</Text>
      </Container>
    );
  }

  if (!collection) {
    return (
      <Container size="sm" style={{ paddingTop: '2rem', paddingBottom: '2rem' }}>
        <Text>Collection not found</Text>
      </Container>
    );
  }

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
            checked={collection.isPublic} 
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
                  <Text>{artwork.dateOfCreation}</Text>
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