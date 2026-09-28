import React, { useState, useEffect } from "react";
import { Text, Button, Group, Card } from "@mantine/core";
import { Link, useParams } from "react-router-dom";
import { collectionService } from "@/services/collectionService";
import { artworkService } from "@/services/artworkService";
import type { Artwork, Collection } from "@/types";

const CollectionPage: React.FC = () => {
  const { collectionId } = useParams<{ collectionId: string }>();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCollectionData = async () => {
      if (!collectionId) return;

      try {
        // Fetch the collection
        const fetchedCollection =
          await collectionService.getCollection(collectionId);
        if (!fetchedCollection) {
          setError("Collection not found");
          setLoading(false);
          return;
        }

        setCollection(fetchedCollection);

        // Fetch artworks for this collection
        const fetchedArtworks =
          await artworkService.getCollectionArtworks(collectionId);
        setArtworks(fetchedArtworks);

        setLoading(false);
      } catch (err) {
        console.error("Error fetching collection data:", err);
        setError("Failed to fetch collection data");
        setLoading(false);
      }
    };

    void fetchCollectionData();
  }, [collectionId]);

  if (loading) {
    return <Text>Loading collection...</Text>;
  }

  if (error) {
    return <Text color="red">{error}</Text>;
  }

  if (!collection) {
    return <Text>Collection not found</Text>;
  }

  return (
    <>
      <Group justify="space-between" mb="xl">
        <Text size="h2">{collection.name}</Text>
        <Button
          component={Link}
          to={`/manage/collection/${collectionId}/settings`}
        >
          Settings
        </Button>
      </Group>

      <Card shadow="sm" p="lg" mb="md">
        <Group justify="center" mb="md">
          <Button
            component={Link}
            to={`/manage/collection/${collectionId}/artwork/add`}
          >
            Add Artwork
          </Button>
        </Group>
      </Card>

      {artworks.length === 0 ? (
        <Text ta="center">No artworks in this collection yet.</Text>
      ) : (
        <div>
          {artworks.map((artwork) => (
            <Card key={artwork.id} shadow="sm" p="lg" mb="md">
              <Group justify="space-between">
                <div>
                  <Text size="h3">{artwork.title}</Text>
                  <Text>{artwork.artistName}</Text>
                  <Text>{artwork.dateOfCreation}</Text>
                  {artwork.editions ? (
                    <Text>Editions: {artwork.editions}</Text>
                  ) : null}
                  {artwork.provenance ? (
                    <Text>Provenance: {artwork.provenance}</Text>
                  ) : null}
                </div>
                <Button
                  component={Link}
                  to={`/manage/collection/${collectionId}/artwork/${artwork.id}`}
                >
                  Edit
                </Button>
              </Group>
            </Card>
          ))}
        </div>
      )}
    </>
  );
};

export default CollectionPage;
