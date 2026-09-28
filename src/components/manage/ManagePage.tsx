import React, { useState, useEffect } from "react";
import { Text, Button, Group, Card, Loader } from "@mantine/core";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import type { Collection } from "@/types";

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
        const q = query(
          collection(db, "collections"),
          where("userId", "==", userId),
        );
        const querySnapshot = await getDocs(q);
        // `doc.data()` is untyped Firestore data, so the spread is asserted
        // here — same pattern as collectionService.getUserCollections.
        const fetchedCollections = querySnapshot.docs.map((doc) => {
          return {
            id: doc.id,
            ...doc.data(),
          } as Collection;
        });
        setCollections(fetchedCollections);
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
        <Text size="h2">My Collections</Text>
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
                  to={`/manage/collection/${collection.id}`}
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
