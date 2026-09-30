import React, { useState, useEffect } from "react";
import { deleteField } from "firebase/firestore";
import {
  Box,
  Container,
  Text,
  TextInput,
  Textarea,
  Switch,
  SegmentedControl,
  PasswordInput,
  Button,
  Group,
  Card,
  Divider,
  Alert,
  Loader,
  Select,
  NumberInput,
} from "@mantine/core";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { collectionService } from "../../services/collectionService";
import { isMaintenanceAdmin } from "@/utils/maintenanceAccess";
import { collectionSlug, parseId } from "../../utils/slug";
import {
  DEFAULT_SKIN_ID,
  SKINS,
  resolveSkin,
  resolveSkinOptions,
} from "@/skins/registry";
import type { SkinOptionValue } from "@/skins/types";
import type { CollectionUpdate } from "@/types";

/** Shallow equality over the option bag. Order does not matter, values do. */
const optionsChanged = (
  next: Record<string, SkinOptionValue>,
  loaded: Record<string, SkinOptionValue>,
): boolean => {
  const keys = new Set([...Object.keys(next), ...Object.keys(loaded)]);
  for (const key of keys) {
    if (next[key] !== loaded[key]) {
      return true;
    }
  }
  return false;
};

const CollectionSettingsPage: React.FC = () => {
  const { currentUser } = useAuth();
  const canRunMigrations = isMaintenanceAdmin(currentUser?.email);
  const { collectionId: param } = useParams<{ collectionId: string }>();
  // Routes carry "{slug}-{id}" but Firestore needs the id alone.
  const collectionId = parseId(param ?? "");
  const navigate = useNavigate();

  const [collectionName, setCollectionName] = useState("");
  // The description as typed, and the one that was loaded. Kept apart for the
  // same reason `loadedName` is (below): the save compares against the loaded
  // value, and folding them into one field would make "changed" always true.
  const [description, setDescription] = useState("");
  const [loadedDescription, setLoadedDescription] = useState<string | null>(
    null,
  );
  // The public/private default for a brand-new collection is public
  // (collectionService.createCollection); until the fetch resolves nothing is
  // rendered anyway (loading gate below), so this initial value only matters as
  // the pre-fetch state that the loaded value always overrides.
  const [isPublic, setIsPublic] = useState(true);
  const [requirePassword, setRequirePassword] = useState(false);
  const [password, setPassword] = useState("");

  // The skin and its options, as loaded. Kept apart from the editable buffers
  // below for the same reason `loadedName` is: the save compares against these,
  // and rewriting them on every keystroke would make "changed" always true.
  const [skin, setSkin] = useState(DEFAULT_SKIN_ID);
  const [skinOptions, setSkinOptions] = useState<
    Record<string, SkinOptionValue>
  >({});
  const [loadedSkin, setLoadedSkin] = useState<string | null>(null);
  const [loadedSkinOptions, setLoadedSkinOptions] = useState<
    Record<string, SkinOptionValue>
  >({});

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
  // How many stored option keys the selected skin no longer declares. Surfaced
  // rather than silently dropped: an owner whose skin renamed an option would
  // otherwise see the setting vanish with no explanation, and the only person
  // who can decide what to do about it is them.
  const [staleOptionCount, setStaleOptionCount] = useState(0);

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
          setDescription(collectionData.description ?? "");
          setLoadedDescription(collectionData.description ?? "");
          setIsPublic(Boolean(collectionData.isPublic));

          // Resolved through the registry rather than stored raw, so the form
          // shows the defaults for a collection written before `skin` existed
          // and for a hand-edited value the selected skin does not declare —
          // which is also what the save then compares against.
          const resolved = resolveSkin(collectionData.skin);
          setSkin(resolved.id);
          setLoadedSkin(resolved.id);
          const { options, dropped } = resolveSkinOptions(
            resolved,
            collectionData.skinOptions,
          );
          setSkinOptions(options);
          setLoadedSkinOptions(options);
          setStaleOptionCount(dropped.length);
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
      // `skin`/`skinOptions`/`description` are written only when they actually
      // differ. `updateCollection` is a merge, so writing an identical bag is a
      // wasted write, and `updatedAt` is server-stamped — a no-op save would
      // still move it and read as a real change to anything watching the
      // document.
      //
      // The description is cleared with `deleteField()` rather than an empty
      // string, so a blank description reads as an absent field (the same
      // "cannot clear a value once set" merge trap that motivates
      // `CollectionUpdate`).
      const update: CollectionUpdate = { name, isPublic };
      const descriptionText = description.trim();
      if (descriptionText !== (loadedDescription?.trim() ?? "")) {
        update.description =
          descriptionText === "" ? deleteField() : descriptionText;
      }
      if (skin !== loadedSkin) {
        update.skin = skin;
      }
      if (optionsChanged(skinOptions, loadedSkinOptions)) {
        update.skinOptions = skinOptions;
      }
      await collectionService.updateCollection(collectionId, update);
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

          <Textarea
            label="Description"
            description="Shown on the public view's first artwork."
            placeholder="Enter collection description (optional)"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            autosize
            minRows={3}
            maxRows={8}
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

          <Divider mt="md" mb="md" />

          <Text size="h3" mb="md">
            Public View
          </Text>

          <Select
            label="Skin"
            description="How this collection's public pages are laid out and styled."
            data={SKINS.map((entry) => ({
              value: entry.id,
              label: entry.label,
            }))}
            value={skin}
            allowDeselect={false}
            onChange={(value) => {
              if (!value || value === skin) {
                return;
              }
              // Switching skins resets the options to the new skin's defaults.
              // Carrying the old skin's values across would write keys the new
              // skin does not declare — which `resolveSkinOptions` would then
              // drop again, reporting them as stale.
              const next = resolveSkin(value);
              setSkin(next.id);
              setSkinOptions(resolveSkinOptions(next, undefined).options);
            }}
            mb="md"
          />

          {/*
            The controls are generated from the selected skin's own option
            vocabulary rather than hand-written per skin, which is why adding a
            skin needs no change to this page. A skin with no options renders
            nothing here.
          */}
          {resolveSkin(skin).options.map((spec) =>
            spec.kind === "boolean" ? (
              <Group key={spec.key} justify="space-between" mb="md">
                <Box>
                  <Text>{spec.label}</Text>
                  {spec.description ? (
                    <Text size="sm" c="dimmed">
                      {spec.description}
                    </Text>
                  ) : null}
                </Box>
                <Switch
                  checked={skinOptions[spec.key] === true}
                  onChange={(e) =>
                    setSkinOptions((current) => ({
                      ...current,
                      [spec.key]: e.currentTarget.checked,
                    }))
                  }
                  aria-label={spec.label}
                />
              </Group>
            ) : spec.kind === "number" ? (
              <NumberInput
                key={spec.key}
                label={spec.label}
                description={spec.description}
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={Number(skinOptions[spec.key] ?? spec.default)}
                onChange={(value) =>
                  setSkinOptions((current) => ({
                    ...current,
                    [spec.key]:
                      typeof value === "number" ? value : spec.default,
                  }))
                }
                mb="md"
              />
            ) : (
              <TextInput
                key={spec.key}
                label={spec.label}
                description={spec.description}
                value={String(skinOptions[spec.key] ?? spec.default)}
                onChange={(e) =>
                  setSkinOptions((current) => ({
                    ...current,
                    [spec.key]: e.currentTarget.value,
                  }))
                }
                mb="md"
              />
            ),
          )}

          {staleOptionCount > 0 ? (
            <Alert color="yellow" mb="md" title="Unused options">
              {staleOptionCount === 1
                ? "One saved option is not used by this skin and will be dropped when you save."
                : `${staleOptionCount} saved options are not used by this skin and will be dropped when you save.`}
            </Alert>
          ) : null}

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
        <Group
          grow
          justify="space-between"
          align="center"
          gap="xl"
          wrap="nowrap"
        >
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

      {canRunMigrations && (
        <Card shadow="sm" p="lg" mt="lg">
          <Group
            grow
            justify="space-between"
            align="center"
            gap="xl"
            wrap="nowrap"
          >
            <Box>
              <Text fw={600}>Data migrations</Text>
              <Text size="sm" c="dimmed">
                Bring documents saved before a field was added up to the current
                shape. Needed when older artworks go missing from a list after
                an update.
              </Text>
            </Box>
            <Button component={Link} to="/manage/migrations" variant="default">
              Open
            </Button>
          </Group>
        </Card>
      )}
    </Container>
  );
};

export default CollectionSettingsPage;
