import React, { useState } from "react";
import {
  Container,
  Text,
  Button,
  Group,
  TextInput,
  Textarea,
  Alert,
  Loader,
} from "@mantine/core";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import { collection, addDoc, doc, setDoc } from "firebase/firestore";
import { db } from "../../../services/firebase";
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
      // Create collection document
      const newCollection = {
        name: name.trim(),
        description: description.trim(),
        userId: currentUser.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const docRef = await addDoc(collection(db, "collections"), newCollection);

      // Generate URLized name for redirect
      const urlizedName = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      // Redirect to the newly created collection page
      navigate(`/manage/collection/${urlizedName}-${docRef.id}`);
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
      navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return (
    <Container size="sm" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Group position="apart" mb="xl">
        <Text size="h2">Create New Collection</Text>
        <Button variant="subtle" onClick={handleLogout}>
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

      <form onSubmit={handleSubmit}>
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

        <Group position="right" mt="md">
          <Button type="submit" disabled={loading}>
            {loading ? <Loader size="sm" /> : "Create Collection"}
          </Button>
        </Group>
      </form>
    </Container>
  );
};

export default NewCollectionPage;
