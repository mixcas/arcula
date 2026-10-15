import React, { useState, useEffect } from "react";
import { Text, Button, Group, Card, Loader } from "@mantine/core";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { collectionService } from "@/services/collectionService";
import { collectionLimitForTier, collectionSlug } from "@arcula/shared";
import type { Collection } from "@arcula/shared";

const ManagePage: React.FC = () => {
  const { currentUser, me } = useAuth();
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

  // The cap the UI reflects. The limit is read off the session's tier the
  // same way the API reads it on create — one shared function, so the two
  // cannot name the number differently. Enforcement is the API's (409
  // limit-reached); the UI only reflects it, and neither the counter nor
  // the disabled button is a security boundary — they must never be
  // described as one.
  const limit = collectionLimitForTier(me?.tier);
  const atCap = collections.length >= limit;

  return (
    <>
      <Group mb="xl" justify="space-between" align="center">
        <Text size="h1">My Collections</Text>
        <Group gap="sm">
          <Text size="sm" c="dim">
            {collections.length} of {limit} collection
            {limit === 1 ? "" : "s"}
          </Text>
          {atCap ? (
            // A disabled button, not a disabled link: an anchor's
            // `disabled` is not an attribute, so a `component={Link}`
            // button at the cap would still navigate to a form the server
            // refuses. A real disabled control cannot, and it is the one
            // that reads as "not offered".
            <Button variant="outline" disabled>
              New collection
            </Button>
          ) : (
            <Button
              component={Link}
              to="/manage/collection/new"
              variant="outline"
            >
              New collection
            </Button>
          )}
        </Group>
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
