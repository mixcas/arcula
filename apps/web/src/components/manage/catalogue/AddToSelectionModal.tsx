/**
 * **Add to Selection**, from the Catalogue's checked works.
 *
 * One controlled modal rather than a menu: the list of the Catalogue's
 * Selections and a **New Selection** entry have to sit together, and a `Menu`
 * cannot carry a name field. The works were checked on the list in some order;
 * this appends them in exactly that order, and the server skips any that are
 * already curated, so a second visit is harmless.
 *
 * The caller owns `opened`; the modal owns its load, its form and the write. On
 * success it notifies and tells the caller which Selection changed, so a page
 * that shows a Selections list can re-read it.
 */

import React, { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Radio,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { SelectionPageRow } from "@arcula/shared";
import { selectionService } from "@/services/selectionService";

interface AddToSelectionModalProps {
  opened: boolean;
  onClose: () => void;
  /** The source Catalogue: the Selections it holds and the writes' address. */
  catalogueId: string;
  /** The checked works, in the order they were checked. */
  artworkIds: string[];
  /** The append succeeded; names the Selection and how many works were sent. */
  onAdded?: (selectionName: string, workCount: number) => void;
}

/** The value of the "start a new one here" option. A Selection's own id is
 *  minted digits-and-letters, so this can never collide with one. */
const NEW_SELECTION = "new-selection";

const workCountLabel = (count: number): string =>
  `${count} work${count === 1 ? "" : "s"}`;

/**
 * The shell mounts its body only while the modal is open, so the Selections it
 * offers and the name of a new one are read fresh each time.
 */
const AddToSelectionModal: React.FC<AddToSelectionModalProps> = (props) => (
  <Modal
    opened={props.opened}
    onClose={props.onClose}
    title="Add to selection"
    centered
    size="lg"
  >
    {props.opened ? <AddToSelectionBody {...props} /> : null}
  </Modal>
);

const AddToSelectionBody: React.FC<AddToSelectionModalProps> = ({
  onClose,
  catalogueId,
  artworkIds,
  onAdded,
}) => {
  const [selections, setSelections] = useState<SelectionPageRow[]>([]);
  const [choice, setChoice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void selectionService
      .list(catalogueId)
      .then((rows) => {
        if (cancelled) return;
        setSelections(rows);
        // One Selection is the common case: choosing it for the person saves a
        // click and says nothing they did not already know.
        if (rows.length === 1) setChoice(rows[0].id);
        else if (rows.length === 0) setChoice(NEW_SELECTION);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("Error loading the selections:", err);
        setError("Could not load this catalogue's selections. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [catalogueId]);

  const creating = choice === NEW_SELECTION;
  const nameBlank = creating && name.trim() === "";
  const nothingToAdd = artworkIds.length === 0;

  const confirm = async () => {
    if (choice === null || nameBlank || nothingToAdd) return;
    setSaving(true);
    setError(null);
    try {
      let targetId = choice;
      let targetName = selections.find((row) => row.id === choice)?.name ?? "";
      if (creating) {
        const created = await selectionService.create(catalogueId, {
          name,
          description: description.trim() === "" ? undefined : description,
        });
        targetId = created.id;
        targetName = created.name;
      }
      await selectionService.addWorks(catalogueId, targetId, artworkIds);
      onAdded?.(targetName, artworkIds.length);
      onClose();
      notifications.show({
        color: "green",
        title: "Added",
        message: `${workCountLabel(artworkIds.length)} added to “${targetName}”.`,
      });
    } catch (err) {
      console.error("Error adding the checked works to a selection:", err);
      setError("Could not add those works. Nothing was changed — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {workCountLabel(artworkIds.length)} will be added in the order you
        checked them.
      </Text>

      {error ? <Alert color="red">{error}</Alert> : null}

      {loading ? (
        <Loader />
      ) : (
        <Radio.Group
          value={choice}
          onChange={setChoice}
          label="Selection"
          withAsterisk
        >
          <Stack gap="xs" mt="xs">
            {selections.map((row) => (
              <Radio
                key={row.id}
                value={row.id}
                label={
                  <Group gap="xs" wrap="wrap">
                    <Text size="sm">{row.name}</Text>
                    <Text size="xs" c="dimmed">
                      {workCountLabel(row.workCount)}
                    </Text>
                  </Group>
                }
              />
            ))}
            <Radio value={NEW_SELECTION} label="New selection" />
          </Stack>
        </Radio.Group>
      )}

      {creating ? (
        <Stack gap="sm">
          <TextInput
            label="Name"
            placeholder="Fair 2026"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            required
          />
          <Textarea
            label="Description"
            description="Optional. Shown under the name on the selection's page."
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
            autosize
            minRows={2}
          />
        </Stack>
      ) : null}

      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => void confirm()}
          loading={saving}
          disabled={choice === null || nameBlank || nothingToAdd || loading}
        >
          Add to selection
        </Button>
      </Group>
    </Stack>
  );
};

export default AddToSelectionModal;
