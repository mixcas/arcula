/**
 * One Selection's manage page: its settings block and the delete control.
 *
 * This slice owns the name, the description and the delete. The ordered works
 * list, **Add works** and the publish controls arrive in the next slices; the
 * page's shape leaves room for them without pretending to have them.
 *
 * Every save re-reads the document and only then notifies, so the form is the
 * server's answer rather than a local copy. The delete confirmation says the
 * true consequence: the Selection goes, its works and their photos and the
 * source Catalogue stay exactly where they are.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  catalogueSlug,
  parseId,
  selectionSlug,
  type Catalogue,
  type Selection,
  type SelectionUpdatePayload,
} from "@arcula/shared";
import { ApiRequestError } from "@/services/api";
import { catalogueService } from "@/services/catalogueService";
import { selectionService } from "@/services/selectionService";

const DELETE_MODAL_ID = "delete-selection";

interface SettingsProps {
  selection: Selection;
  saving: boolean;
  onSave: (payload: SelectionUpdatePayload) => Promise<void>;
}

/**
 * The settings form, keyed by the server's document so a save that changes it
 * remounts the inputs with the stored values. Only the changed keys reach the
 * payload; an emptied description is `null`, which clears the column.
 */
const SelectionSettings: React.FC<SettingsProps> = ({
  selection,
  saving,
  onSave,
}) => {
  const [name, setName] = useState(selection.name);
  const [description, setDescription] = useState(selection.description ?? "");

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const currentDescription = selection.description ?? "";

  const payload: SelectionUpdatePayload = {};
  if (trimmedName !== "" && trimmedName !== selection.name) {
    payload.name = trimmedName;
  }
  if (trimmedDescription !== currentDescription) {
    payload.description = trimmedDescription === "" ? null : trimmedDescription;
  }

  const canSave =
    trimmedName !== "" && Object.keys(payload).length > 0 && !saving;

  return (
    <Card withBorder padding="lg">
      <Stack>
        <Text size="h3">Settings</Text>
        <TextInput
          label="Name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          required
        />
        <Textarea
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
          autosize
          minRows={3}
        />
        <Group justify="flex-end">
          <Button
            onClick={() => void onSave(payload)}
            disabled={!canSave}
            loading={saving}
          >
            Save changes
          </Button>
        </Group>
      </Stack>
    </Card>
  );
};

const SelectionPage: React.FC = () => {
  const { catalogueId: param, selectionId: selectionParam } = useParams<{
    catalogueId: string;
    selectionId: string;
  }>();
  // Both segments carry "{slug}-{id}" and are parsed independently; the API
  // only ever knows the id.
  const catalogueId = parseId(param ?? "");
  const selectionId = parseId(selectionParam ?? "");
  const navigate = useNavigate();

  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async (): Promise<Selection | null> => {
    if (!catalogueId || !selectionId) return null;
    const next = await selectionService.get(catalogueId, selectionId);
    if (next) setSelection(next);
    return next;
  }, [catalogueId, selectionId]);

  useEffect(() => {
    if (!catalogueId || !selectionId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [loadedCatalogue, loadedSelection] = await Promise.all([
          catalogueService.getCatalogue(catalogueId),
          selectionService.get(catalogueId, selectionId),
        ]);
        if (cancelled) return;
        if (!loadedCatalogue) {
          setLoadError("Catalogue not found");
          return;
        }
        setCatalogue(loadedCatalogue);
        if (!loadedSelection) {
          setLoadError("Selection not found");
          return;
        }
        setSelection(loadedSelection);
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        console.error("Error loading the selection:", err);
        setLoadError("Could not load the selection. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [catalogueId, selectionId]);

  // Canonicalise both segments once the documents are readable. A rename
  // changes the slug and nothing the server looks up; `replace` keeps Back
  // pointing at wherever the member came from.
  useEffect(() => {
    if (!param || !selectionParam || !catalogue || !selection) return;
    const canonicalCatalogue = catalogueSlug(catalogue.name, catalogue.id);
    const canonicalSelection = selectionSlug(selection.name, selection.id);
    if (param === canonicalCatalogue && selectionParam === canonicalSelection) {
      return;
    }
    void navigate(
      `/manage/catalogue/${canonicalCatalogue}/selection/${canonicalSelection}`,
      { replace: true },
    );
  }, [param, selectionParam, catalogue, selection, navigate]);

  const save = async (payload: SelectionUpdatePayload) => {
    if (Object.keys(payload).length === 0) return;
    setSaving(true);
    try {
      await selectionService.update(catalogueId, selectionId, payload);
      const next = await reload();
      if (!next) {
        setLoadError("Selection not found");
        return;
      }
      notifications.show({
        color: "green",
        title: "Saved",
        message: "Selection settings saved.",
      });
    } catch (err) {
      console.error("Error saving the selection:", err);
      notifications.show({
        color: "red",
        title: "Save failed",
        message:
          "Could not save the settings. Nothing was changed — try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (name: string) => {
    try {
      await selectionService.remove(catalogueId, selectionId);
      modals.close(DELETE_MODAL_ID);
      notifications.show({
        color: "green",
        title: "Selection deleted",
        message: `“${name}” was removed. Its works and photos are untouched.`,
      });
      if (catalogue) {
        void navigate(
          `/manage/catalogue/${catalogueSlug(catalogue.name, catalogue.id)}/selections`,
        );
      }
    } catch (err) {
      console.error("Error deleting the selection:", err);
      notifications.show({
        color: "red",
        title: "Delete failed",
        message:
          err instanceof ApiRequestError
            ? err.message
            : "Could not delete the selection. Nothing was removed — try again.",
      });
    }
  };

  const confirmDelete = (target: Selection) => {
    modals.openConfirmModal({
      modalId: DELETE_MODAL_ID,
      title: `Delete “${target.name}”?`,
      centered: true,
      children: (
        <Text size="sm">
          The selection will be removed and its address will stop working. Its
          works, their photos and the Catalogue are untouched.
        </Text>
      ),
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => {
        void remove(target.name);
      },
    });
  };

  if (!catalogueId || !selectionId) {
    return <Alert color="red">That selection link is not valid.</Alert>;
  }

  if (loading) {
    return <Loader />;
  }

  if (loadError) {
    return <Alert color="red">{loadError}</Alert>;
  }

  // The load resolves to exactly one of a document and an error before
  // `loading` clears; this is the compiler's witness to that invariant.
  if (!catalogue || !selection) {
    return <Loader />;
  }

  const settingsKey = [
    selection.id,
    selection.updatedAt?.seconds ?? 0,
    selection.updatedAt?.nanoseconds ?? 0,
  ].join(":");

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="center" gap="xl">
        <Group>
          <Text size="h2">{selection.name}</Text>
          <Text c="dimmed" size="sm">
            from {catalogue.name}
          </Text>
        </Group>
        <Button
          component={Link}
          to={`/manage/catalogue/${catalogueSlug(
            catalogue.name,
            catalogue.id,
          )}/selections`}
          variant="outline"
        >
          Back to selections
        </Button>
      </Group>

      <SelectionSettings
        key={settingsKey}
        selection={selection}
        saving={saving}
        onSave={save}
      />

      {/* The ordered works list, Add works and the publish controls land in the
          next slices. This slice deliberately renders none of them. */}

      <Card withBorder padding="lg">
        <Stack>
          <Text size="h3">Delete selection</Text>
          <Text size="sm" c="dimmed">
            Deleting a selection removes it from this catalogue&rsquo;s list.
            Its works, their photos and the Catalogue are untouched.
          </Text>
          <Group justify="flex-end">
            <Button
              color="red"
              variant="light"
              onClick={() => confirmDelete(selection)}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
};

export default SelectionPage;
