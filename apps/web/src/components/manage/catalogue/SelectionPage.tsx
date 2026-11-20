/**
 * One Selection's manage page: its ordered works and its settings block.
 *
 * The works list is the curation surface — add, reorder, remove — and the
 * settings own the name, the description, the visibility (Private, Public,
 * Protected) and the password. The publish warning, the Draft count and the PDF
 * arrive in later slices; the page's shape leaves room for them without
 * pretending to have them.
 *
 * Every save or curation re-reads what it changed and only then notifies, so the
 * page is the server's answer rather than a local copy. The delete confirmation
 * says the true consequence: the Selection goes, its works and their photos and
 * the source Catalogue stay exactly where they are.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  PasswordInput,
  SegmentedControl,
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
  type Artwork,
  type Catalogue,
  type Selection,
  type SelectionUpdatePayload,
} from "@arcula/shared";
import { ApiRequestError } from "@/services/api";
import { catalogueService } from "@/services/catalogueService";
import { selectionService } from "@/services/selectionService";
import SelectionWorksList from "./SelectionWorksList";
import {
  catalogueRisk,
  needsPasswordFields,
  publishRisk,
  resolveSelectionSave,
  storedVisibility,
  type PublishRisk,
  type SelectionVisibility,
} from "./selectionSettingsSave";

const DELETE_MODAL_ID = "delete-selection";
const PUBLISH_MODAL_ID = "publish-selection";

/**
 * What the confirmation says before the PATCH: the number of drafts first, then
 * the Catalogue's state.
 *
 * The count is the risk and the state is why it is one, so the two are stated
 * and nothing is argued. A warning is a plain surface — no alarm, no softening,
 * and no sentence that the reader has to decode.
 */
const publishWarningBody = (
  risk: PublishRisk,
  catalogueName: string,
): string => {
  const state = `“${catalogueName}” is ${risk.catalogueState}.`;
  if (risk.draftCount === 0) {
    return `This selection has no drafts. ${state}`;
  }
  const drafts =
    risk.draftCount === 1
      ? "1 draft in this selection will be readable at its address."
      : `${risk.draftCount} drafts in this selection will be readable at its address.`;
  return `${drafts} ${state}`;
};

/**
 * The dimmed line the page carries while the state holds: the same two facts,
 * in the present tense of a page someone is looking at on any visit.
 */
const publishWarningNote = (
  risk: PublishRisk,
  catalogueName: string,
): string => {
  const standing = `This selection is public while “${catalogueName}” is ${risk.catalogueState}.`;
  if (risk.draftCount === 0) {
    return `${standing} It has no drafts.`;
  }
  const drafts =
    risk.draftCount === 1
      ? "It has 1 draft, which is readable at the selection's address."
      : `It has ${risk.draftCount} drafts, which are readable at the selection's address.`;
  return `${standing} ${drafts}`;
};

interface SettingsProps {
  selection: Selection;
  saving: boolean;
  onSave: (payload: SelectionUpdatePayload) => Promise<void>;
}

/** What each visibility means, in one sentence the member can act on. */
const VISIBILITY_DESCRIPTION: Record<SelectionVisibility, string> = {
  private: "Only the Catalogue's members can open this selection.",
  public: "Anyone with the link can read this selection.",
  protected: "Anyone with the link needs a password to read this selection.",
};

/**
 * The settings form, keyed by the server's document so a save that changes it
 * remounts the inputs with the stored values.
 *
 * The three visibility states are the product's, not the wire's: Private is
 * `isPublic: false`, Public is public without a password, and Protected is
 * public with one. The pure fold in `selectionSettingsSave` turns what the
 * member chose into the PATCH, so this component only holds the inputs.
 */
const SelectionSettings: React.FC<SettingsProps> = ({
  selection,
  saving,
  onSave,
}) => {
  const [name, setName] = useState(selection.name);
  const [description, setDescription] = useState(selection.description ?? "");
  const [visibility, setVisibility] = useState<SelectionVisibility>(() =>
    storedVisibility({
      isPublic: selection.isPublic,
      isPasswordProtected: selection.isPasswordProtected === true,
    }),
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [editingPassword, setEditingPassword] = useState(false);

  const loaded = {
    name: selection.name,
    description: selection.description ?? null,
    isPublic: selection.isPublic,
    isPasswordProtected: selection.isPasswordProtected === true,
  };
  const decision = resolveSelectionSave(loaded, {
    name,
    description,
    visibility,
    password,
    confirm,
    editingPassword,
  });
  const clean =
    decision.kind === "payload" && Object.keys(decision.payload).length === 0;

  const chooseVisibility = (value: string) => {
    setVisibility(value as SelectionVisibility);
    // The password fields belong to a choice, not to a buffer that outlives it:
    // a half-typed password from another state must not be saved unseen.
    setEditingPassword(false);
    setPassword("");
    setConfirm("");
  };

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

        <Divider my="xs" />

        <Text size="h4">Visibility</Text>
        <SegmentedControl
          data={[
            { label: "Private", value: "private" },
            { label: "Public", value: "public" },
            { label: "Protected", value: "protected" },
          ]}
          value={visibility}
          onChange={chooseVisibility}
          fullWidth
        />
        <Text size="sm" c="dimmed">
          {VISIBILITY_DESCRIPTION[visibility]}
        </Text>

        {visibility === "protected" &&
        selection.isPasswordProtected === true &&
        !editingPassword ? (
          <Box>
            <Text size="sm" fw={600}>
              A password is set. It stays in effect until you change or remove
              it.
            </Text>
            <Group mt="xs">
              <Button
                variant="light"
                onClick={() => {
                  setPassword("");
                  setConfirm("");
                  setEditingPassword(true);
                }}
              >
                Change password
              </Button>
              <Button
                variant="subtle"
                onClick={() => {
                  // Clearing the password makes the Selection public and
                  // unprotected; saying so in the control is what keeps the
                  // three states honest.
                  chooseVisibility("public");
                }}
              >
                Remove password
              </Button>
            </Group>
          </Box>
        ) : null}

        {needsPasswordFields(loaded, {
          visibility,
          editingPassword,
        }) ? (
          <>
            <PasswordInput
              label="Password"
              description="Visitors need this password to read the selection."
              placeholder="At least 8 characters"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
            <PasswordInput
              label="Confirm password"
              placeholder="Type it again"
              value={confirm}
              onChange={(event) => setConfirm(event.currentTarget.value)}
            />
            {editingPassword ? (
              <Button
                variant="subtle"
                onClick={() => {
                  setEditingPassword(false);
                  setPassword("");
                  setConfirm("");
                }}
              >
                Cancel password change
              </Button>
            ) : null}
          </>
        ) : null}

        {decision.kind === "error" ? (
          <Alert color="red">{decision.message}</Alert>
        ) : null}

        <Group justify="flex-end">
          <Button
            onClick={() => {
              if (decision.kind === "payload") {
                void onSave(decision.payload);
              }
            }}
            disabled={clean || decision.kind === "error"}
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
  const [works, setWorks] = useState<Artwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async (): Promise<Selection | null> => {
    if (!catalogueId || !selectionId) return null;
    const next = await selectionService.get(catalogueId, selectionId);
    if (next) setSelection(next);
    return next;
  }, [catalogueId, selectionId]);

  // The works read is the one ordered read: it resolves this session and
  // answers the member audience, because the page's reader is a member of the
  // source Catalogue.
  const reloadWorks = useCallback(async (): Promise<void> => {
    if (!selectionId) return;
    setWorks(await selectionService.getWorks(selectionId));
  }, [selectionId]);

  const reloadPage = useCallback(async (): Promise<void> => {
    await Promise.all([reload(), reloadWorks()]);
  }, [reload, reloadWorks]);

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
        // The works read comes after the document: its 404 means the same
        // "not found" the document's `null` already answered, and asking it
        // first would turn a missing Selection into a generic failure.
        const loadedWorks = await selectionService.getWorks(selectionId);
        if (cancelled) return;
        setWorks(loadedWorks);
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

  /** The PATCH itself, once the member has chosen to make it. */
  const write = async (payload: SelectionUpdatePayload) => {
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

  const save = async (payload: SelectionUpdatePayload) => {
    if (Object.keys(payload).length === 0) return;
    // The warning is computed on the member read — the source Catalogue's own
    // state — because the public read carries only its name. Both documents are
    // loaded before the page renders a Save control; the guard is the
    // compiler's witness, not a case at runtime.
    if (!selection || !catalogue) return;
    const risk = publishRisk({ selection, update: payload, catalogue, works });
    if (risk === null) {
      await write(payload);
      return;
    }
    modals.openConfirmModal({
      modalId: PUBLISH_MODAL_ID,
      title: `Publish “${selection.name}”?`,
      centered: true,
      children: (
        <Text size="sm">{publishWarningBody(risk, catalogue.name)}</Text>
      ),
      labels: { confirm: "Publish", cancel: "Cancel" },
      onConfirm: () => {
        // Cancelling leaves the Selection private: nothing is written until
        // this runs, and the modal owns the choice.
        void write(payload);
      },
    });
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

  // The fact stays on the page while it holds: a public Selection over a
  // Catalogue a visitor cannot read. Unpublishing, or the Catalogue becoming
  // visitor-readable, takes it away with it.
  const note = selection.isPublic ? catalogueRisk(catalogue, works) : null;

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

      {note ? (
        <Text size="sm" c="dimmed">
          {publishWarningNote(note, catalogue.name)}
        </Text>
      ) : null}

      <SelectionSettings
        key={settingsKey}
        selection={selection}
        saving={saving}
        onSave={save}
      />

      <SelectionWorksList
        catalogueId={catalogueId}
        selectionId={selectionId}
        works={works}
        onChanged={reloadPage}
      />

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
