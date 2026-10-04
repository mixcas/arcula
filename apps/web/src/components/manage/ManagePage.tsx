import React, { useState, useEffect } from "react";
import { Text, Button, Group, Card, Loader } from "@mantine/core";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { collectionService } from "@/services/collectionService";
import { collectionSlug } from "@arcula/shared";
import type { Collection } from "@arcula/shared";

const ManagePage: React.FC = () => {
  const { currentUser } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Depend on the uid rather than the user object, so the effect re-runs only
  // when the signed-in user changes and `userId` is narrowed to a string.
  const userId = currentUser?.uid;

  useEffect(() => {
    const fetchCollections = async () => {
      if (!userId) return;

      try {
        // The session decides whose collections these are; the client sends
        // nothing but the path.
        setCollections(await collectionService.getUserCollections());
      } catch (err) {
        console.error("Error fetching collections:", err);
        setError("Failed to fetch collections");
      } finally {
        setLoading(false);
      }
    };

    void fetchCollections();
  }, [userId]);

  if (loading) {
    return (
      <Group justify="center">
        <Loader />
      </Group>
    );
  }

  if (error) {
    return (
      <Text color="red" ta="center">
        {error}
      </Text>
    );
  }

  return (
    <>
      <Group mb="xl">
        <Text size="h1">My Collections</Text>
      </Group>

      {collections.length === 0 ? (
        <Text>No collections yet. Create your first collection!</Text>
      ) : (
        <div>
          {collections.map((collection) => (
            <Card key={collection.id} shadow="sm" p="lg" mb="md">
              <Group>
                <Text size="h3">{collection.name}</Text>
                <Button
                  component={Link}
                  to={`/manage/collection/${collectionSlug(collection.name, collection.id)}`}
                >
                  View
                </Button>
              </Group>
            </Card>
          ))}
        </div>
      )}
    </>
  );
};

export default ManagePage;
