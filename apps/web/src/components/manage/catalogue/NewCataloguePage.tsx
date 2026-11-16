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
import { catalogueSlug } from "@arcula/shared";
import { catalogueService } from "@/services/catalogueService";
import { ApiRequestError } from "@/services/api";

const NewCataloguePage: React.FC = () => {
  const { currentUser, logout } = useAuth();
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
      setError("Catalogue name is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // The answer is the created catalogue — id, name and all — so the
      // redirect slugs from the server's record rather than the form's.
      const created = await catalogueService.createCatalogue({
        name: name.trim(),
        description: description.trim(),
      });

      // Redirect to the newly created catalogue page
      void navigate(
        `/manage/catalogue/${catalogueSlug(created.name, created.id)}`,
      );
      setSuccess(true);
    } catch (err) {
      console.error("Error creating catalogue:", err);
      // Hitting the tier cap is the one failure with a message worth showing
      // as-is ("You can have at most N catalogues on the free tier"); every
      // other error stays generic.
      setError(
        err instanceof ApiRequestError &&
          err.status === 409 &&
          err.code === "limit-reached"
          ? err.message
          : "Failed to create catalogue. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      void navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return (
    <>
      <Group mb="xl">
        <Text size="h2">Create New Catalogue</Text>
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
          Catalogue created successfully!
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
          label="Catalogue Name"
          placeholder="Enter catalogue name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          mb="md"
        />

        <Textarea
          label="Description"
          placeholder="Enter catalogue description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          mb="md"
        />

        <Group mt="md">
          <Button type="submit" disabled={loading}>
            {loading ? <Loader size="sm" /> : "Create Catalogue"}
          </Button>
        </Group>
      </form>
    </>
  );
};

export default NewCataloguePage;
