import React, { useState, useEffect } from "react";
import { Text, Button, Group, Card, Loader } from "@mantine/core";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";

const ManagePage: React.FC = () => {
  const { currentUser } = useAuth();
  const [collections, setCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCollections = async () => {
      if (!currentUser) return;

      try {
        const q = query(
          collection(db, "collections"),
          where("userId", "==", currentUser.uid),
        );
        const querySnapshot = await getDocs(q);
        const fetchedCollections = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setCollections(fetchedCollections);
      } catch (err) {
        console.error("Error fetching collections:", err);
        setError("Failed to fetch collections");
      } finally {
        setLoading(false);
      }
    };

    fetchCollections();
  }, [currentUser.uid]);

  if (loading) {
    return (
      <Group position="center">
        <Loader />
      </Group>
    );
  }

  if (error) {
    return (
      <Text color="red" align="center">
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
