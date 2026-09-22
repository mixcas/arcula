import React, { useState, useEffect } from "react";
import {
  Container,
  Text,
  Button,
  Group,
  Card,
  Menu,
  Avatar,
  Loader,
} from "@mantine/core";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { signOut, getAuth } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";

const ManagePage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
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

  const handleLogout = async () => {
    try {
      const auth = getAuth();
      await signOut(auth);
      navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  if (loading) {
    return (
      <Container
        size="sm"
        style={{ paddingTop: "2rem", paddingBottom: "2rem" }}
      >
        <Group position="center">
          <Loader />
        </Group>
      </Container>
    );
  }

  if (error) {
    return (
      <Container
        size="sm"
        style={{ paddingTop: "2rem", paddingBottom: "2rem" }}
      >
        <Text color="red" align="center">
          {error}
        </Text>
      </Container>
    );
  }

  return (
    <Container size="sm" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Group position="apart" mb="xl">
        <Text size="h2">My Collections</Text>
      </Group>

      {collections.length === 0 ? (
        <Text align="center">
          No collections yet. Create your first collection!
        </Text>
      ) : (
        <div>
          {collections.map((collection) => (
            <Card key={collection.id} shadow="sm" p="lg" mb="md">
              <Group position="apart">
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
    </Container>
  );
};

export default ManagePage;
