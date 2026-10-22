import React, { useState, useEffect } from "react";
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
import { collectionService } from "../../services/collectionService";
import { collectionSlug, parseId } from "@arcula/shared";
import {
  DEFAULT_SKIN_ID,
  SKINS,
  resolveSkin,
  resolveSkinOptions,
} from "@/skins/registry";
import type { SkinOptionValue } from "@/skins/types";
import type { CollectionUpdatePayload } from "@arcula/shared";
import AccessCard from "./collection/AccessCard";
import {
  passwordControlMode,
  resolvePasswordWrite,
} from "./collectionPassword";

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
  const { collectionId: param } = useParams<{ collectionId: string }>();
  // Routes carry "{slug}-{id}" but the API needs the id alone.
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
  // Whether the collection already has a password, as the member read
  // reports it. The hash never reaches the browser, so this one bit is all
  // the form gets to know.
  const [isPasswordProtected, setIsPasswordProtected] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // The two deliberate states beyond "show the fields": changing a password
  // that is already set, and a removal waiting for Save.
  const [editingPassword, setEditingPassword] = useState(false);
  const [removingPassword, setRemovingPassword] = useState(false);

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
          setIsPasswordProtected(collectionData.isPasswordProtected === true);

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
      // `skin`/`skinOptions`/`description` are sent only when they actually
      // differ: the patch contract leaves an absent key alone, so a title-only
      // save never rewrites the skin bag, and a no-op save never moves
      // `updatedAt`.
      //
      // A blank description is sent as `null`, not as an empty string: the
      // wire has no "clear" value other than `null`, and an absent key would
      // leave the stored text in place.
      const update: CollectionUpdatePayload = { name, isPublic };
      const descriptionText = description.trim();
      if (descriptionText !== (loadedDescription?.trim() ?? "")) {
        update.description = descriptionText === "" ? null : descriptionText;
      }
      if (skin !== loadedSkin) {
        update.skin = skin;
      }
      if (optionsChanged(skinOptions, loadedSkinOptions)) {
        update.skinOptions = skinOptions;
      }
      // The password is the one field with a confirmation, and the
      // confirmation is a client-side check only: `resolvePasswordWrite`
      // answers what to send, and the payload never carries `confirm`.
      const passwordWrite = resolvePasswordWrite({
        isPublic,
        isPasswordProtected,
        editing: editingPassword,
        removing: removingPassword,
        password,
        confirm: confirmPassword,
      });
      if (passwordWrite.kind === "error") {
        setError(passwordWrite.message);
        return;
      }
      if (passwordWrite.kind === "set") {
        update.password = passwordWrite.password;
      }
      if (passwordWrite.kind === "remove") {
        update.password = null;
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

  const passwordMode = passwordControlMode({
    isPublic,
    isPasswordProtected,
    editing: editingPassword,
    removing: removingPassword,
  });

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
            onChange={(value) => {
              const nextPublic = value === "public";
              setIsPublic(nextPublic);
              if (nextPublic) return;
              // The password control disappears on a private collection.
              // Drop any unsaved password intent with it, rather than
              // applying a hidden Remove or a half-typed change on Save.
              setEditingPassword(false);
              setRemovingPassword(false);
              setPassword("");
              setConfirmPassword("");
            }}
            fullWidth
            mb="md"
          />

          {/*
            The password control, in the four states ADR-0005 names. A
            private collection shows nothing: there is no visitor in front of
            it to protect the works from. The confirmation is checked here and
            never sent — the payload carries `password` alone.
          */}
          {passwordMode === "protected" && (
            <Box mb="md">
              <Text fw={600}>
                Protected — the current password stays in effect
              </Text>
              <Group mt="xs">
                <Button
                  type="button"
                  variant="light"
                  onClick={() => {
                    setPassword("");
                    setConfirmPassword("");
                    setEditingPassword(true);
                    setRemovingPassword(false);
                  }}
                >
                  Reset password
                </Button>
                <Button
                  type="button"
                  variant="subtle"
                  color="red"
                  onClick={() => {
                    setEditingPassword(false);
                    setRemovingPassword(true);
                  }}
                >
                  Remove password
                </Button>
              </Group>
            </Box>
          )}

          {passwordMode === "removing" && (
            <Alert color="yellow" mb="md" title="The password will be removed">
              <Text size="sm">
                Anyone with the link will be able to read this collection again
                as soon as the change is saved.
              </Text>
              <Button
                type="button"
                variant="subtle"
                mt="xs"
                onClick={() => setRemovingPassword(false)}
              >
                Cancel
              </Button>
            </Alert>
          )}

          {(passwordMode === "fields" || passwordMode === "editing") && (
            <>
              <PasswordInput
                label="Password"
                description="Visitors need this password to read the collection."
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                mb="sm"
              />
              <PasswordInput
                label="Confirm password"
                placeholder="Type it again"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                mb="sm"
              />
              {passwordMode === "editing" && (
                <Button
                  type="button"
                  variant="subtle"
                  mb="md"
                  onClick={() => {
                    setPassword("");
                    setConfirmPassword("");
                    setEditingPassword(false);
                  }}
                >
                  Cancel
                </Button>
              )}
            </>
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

      {/* The access card reads its role from the access document, not from
          this page's collection read: a collaborator reaches this page too,
          and whose view to render is an administrative question. Keyed by id
          so another collection starts from a loading card rather than the
          previous collection's members. */}
      <AccessCard key={collectionId} collectionId={collectionId} />

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
    </Container>
  );
};

export default CollectionSettingsPage;
