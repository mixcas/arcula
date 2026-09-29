import React, { useState, useEffect } from "react";
import {
  Box,
  Container,
  Text,
  TextInput,
  Switch,
  SegmentedControl,
  PasswordInput,
  Button,
  Group,
  Card,
  Divider,
  Alert,
  Loader,
} from "@mantine/core";
import { Link, useParams, useNavigate } from "react-router-dom";
import { collectionService } from "../../services/collectionService";
import { collectionSlug, parseId } from "../../utils/slug";

const CollectionSettingsPage: React.FC = () => {
  const { collectionId: param } = useParams<{ collectionId: string }>();
  // Routes carry "{slug}-{id}" but Firestore needs the id alone.
  const collectionId = parseId(param ?? "");
  const navigate = useNavigate();

  const [collectionName, setCollectionName] = useState("");
  // The public/private default for a brand-new collection is public
  // (collectionService.createCollection); until the fetch resolves nothing is
  // rendered anyway (loading gate below), so this initial value only matters as
  // the pre-fetch state that the loaded value always overrides.
  const [isPublic, setIsPublic] = useState(true);
  const [requirePassword, setRequirePassword] = useState(false);
  const [password, setPassword] = useState("");

  // The name as loaded, kept apart from `collectionName` above — that one is
  // the editable buffer, and rewriting the URL from it would fire on every
  // keystroke. Null until the fetch succeeds, which is also what stops the
  // canonicalization below for a collection that could not be loaded.
  const [loadedName, setLoadedName] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Kept apart: a load failure means the form should not render, but a save
  // failure must leave the user's input on screen (same split as
  // ArtworkEditPage).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!collectionId) {
      return;
    }

    const fetchCollection = async () => {
      try {
        const collectionData =
          await collectionService.getCollection(collectionId);
        if (!collectionData) {
          setLoadError("Collection not found");
        } else {
          setCollectionName(collectionData.name ?? "");
          setLoadedName(collectionData.name ?? "");
          setIsPublic(Boolean(collectionData.isPublic));
        }
      } catch (err) {
        console.error("Error fetching collection:", err);
        setLoadError("Failed to load collection settings. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    void fetchCollection();
  }, [collectionId]);

  // Put the canonical "{slug}-{id}" in the address bar once the name is known,
  // keeping this page's own /settings suffix. `replace` swaps the current
  // history entry rather than adding one.
  useEffect(() => {
    if (!param || loadedName === null) {
      return;
    }
    const canonical = collectionSlug(loadedName, collectionId);
    if (canonical === param) {
      return;
    }
    void navigate(`/manage/collection/${canonical}/settings`, {
      replace: true,
    });
  }, [param, loadedName, collectionId, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!collectionId) {
      setError("Invalid collection id");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const name = collectionName.trim();
      await collectionService.updateCollection(collectionId, {
        name,
        isPublic,
      });
      // Build the slug from the name just saved, so the URL reflects the rename
      // rather than carrying the old one.
      void navigate(`/manage/collection/${collectionSlug(name, collectionId)}`);
    } catch (err) {
      console.error("Error updating collection:", err);
      setError("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!collectionId) {
    return <Alert color="red">Invalid collection id</Alert>;
  }

  if (loading) {
    return <Loader />;
  }

  if (loadError) {
    return <Alert color="red">{loadError}</Alert>;
  }

  return (
    <Container size="xl">
      <Text size="h2" mb="xl">
        Collection Settings
      </Text>

      <Card shadow="sm" p="lg">
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <TextInput
            label="Collection Name"
            placeholder="Name of your collection"
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
            required
            mb="md"
          />

          <Divider mt="md" mb="md" />

          <Text size="h3" mb="md">
            Privacy Settings
          </Text>

          <Text>Make Collection Public</Text>
          <SegmentedControl
            data={[
              { label: "Private", value: "private" },
              { label: "Public", value: "public" },
            ]}
            value={isPublic ? "public" : "private"}
            onChange={(value) => setIsPublic(value === "public")}
            fullWidth
            mb="md"
          />

          {isPublic && (
            <Group justify="space-between" mb="md">
              <Text>Require Password for Access</Text>
              <Switch
                checked={requirePassword}
                onChange={(e) => setRequirePassword(e.target.checked)}
                label="Password protected"
              />
            </Group>
          )}

          {requirePassword && (
            <PasswordInput
              label="Password"
              placeholder="Enter password to protect collection"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              mb="md"
            />
          )}

          {error ? (
            <Alert color="red" mb="md">
              {error}
            </Alert>
          ) : null}

          <Group justify="center" mt="xl">
            <Button type="submit" loading={saving}>
              Save Settings
            </Button>
            <Button
              component={Link}
              to={`/manage/collection/${param}`}
              variant="outline"
            >
              Cancel
            </Button>
          </Group>
        </form>
      </Card>

      <Divider my="xl" />

      <Card shadow="sm" p="lg">
        <Group justify="space-between" align="center" gap="xl" wrap="nowrap">
          <Box>
            <Text fw={600}>Import from CSV</Text>
            <Text size="sm" c="dimmed">
              Add artworks in bulk from a comma-separated values file. The file
              is parsed in this browser tab — nothing is uploaded until you
              confirm the import.
            </Text>
          </Box>
          <Button
            component={Link}
            to={`/manage/collection/${param}/import/csv`}
          >
            Import
          </Button>
        </Group>
      </Card>

      <Card shadow="sm" p="lg" mt="lg">
        <Group justify="space-between" align="center" gap="xl" wrap="nowrap">
          <Box>
            <Text fw={600}>Data migrations</Text>
            <Text size="sm" c="dimmed">
              Bring documents saved before a field was added up to the current
              shape. Needed when older artworks go missing from a list after an
              update.
            </Text>
          </Box>
          <Button component={Link} to="/manage/migrations" variant="default">
            Open
          </Button>
        </Group>
      </Card>
    </Container>
  );
};

export default CollectionSettingsPage;
