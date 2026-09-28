import React, { useState } from "react";
import {
  Text,
  Button,
  Group,
  TextInput,
  Textarea,
  Alert,
  Loader,
} from "@mantine/core";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { collectionSlug } from "@/utils/slug";
import { collectionService } from "@/services/collectionService";
import { signOut, getAuth } from "firebase/auth";

const NewCollectionPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentUser) {
      setError("User not authenticated");
      return;
    }

    if (!name.trim()) {
      setError("Collection name is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Create the collection document. Defaults (isPublic/artworks) and
      // timestamps are supplied by collectionService.
      const newId = await collectionService.createCollection({
        name: name.trim(),
        description: description.trim(),
        userId: currentUser.uid,
      });

      // Redirect to the newly created collection page
      void navigate(`/manage/collection/${collectionSlug(name, newId)}`);
      setSuccess(true);
    } catch (err) {
      console.error("Error creating collection:", err);
      setError("Failed to create collection. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const auth = getAuth();
      await signOut(auth);
      void navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return (
    <>
      <Group mb="xl">
        <Text size="h2">Create New Collection</Text>
        <Button
          variant="subtle"
          onClick={() => {
            void handleLogout();
          }}
        >
          Logout
        </Button>
      </Group>

      {success ? (
        <Alert color="green" mb="md">
          Collection created successfully!
        </Alert>
      ) : null}

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
      >
        <TextInput
          label="Collection Name"
          placeholder="Enter collection name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          mb="md"
        />

        <Textarea
          label="Description"
          placeholder="Enter collection description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          mb="md"
        />

        <Group mt="md">
          <Button type="submit" disabled={loading}>
            {loading ? <Loader size="sm" /> : "Create Collection"}
          </Button>
        </Group>
      </form>
    </>
  );
};

export default NewCollectionPage;
