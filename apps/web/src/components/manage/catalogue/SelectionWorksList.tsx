/**
 * The Selection's ordered works list — the manage page's one list, not the
 * artworks Table or Grid.
 *
 * The order is the content, so it is edited directly: a drag handle or the
 * keyboard sensor moves a row, a remove control takes one out, and
 * **Add artworks** appends from the Catalogue's live artworks. There is no sorting, no paging and no
 * per-row link: those belong to the Catalogue's list, and this page is a
 * curation, not a catalogue.
 *
 * Every control is operable without a mouse and named with the work and its
 * position, because the rows are images and a list of them is unnavigable
 * otherwise. Every write states the whole list (`replaceWorks`), so the reorder
 * and the remove are one rule and one request; a mutation then re-reads the
 * list and only then says what happened.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Image,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconGripVertical,
  IconLibraryPlus,
  IconTrash,
} from "@tabler/icons-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { primaryPhotoUrl, type Artwork } from "@arcula/shared";
import { artworkService } from "@/services/artworkService";
import { selectionService } from "@/services/selectionService";
import { moveWorkIds } from "./curationOrder";

interface SelectionWorksListProps {
  /** The source Catalogue — the picker's list and the writes' address. */
  catalogueId: string;
  selectionId: string;
  /** The works, already in the curator's order. */
  works: Artwork[];
  /** Re-read the list (and the Selection) after a write. */
  onChanged: () => Promise<void> | void;
}

/** A draft is off the Catalogue's page; the badge is why it is here. */
const DraftBadge: React.FC = () => (
  <Badge size="sm" variant="light" color="gray">
    Draft
  </Badge>
);

/**
 * The standing Draft count: a fact about this list, not a warning.
 *
 * A Selection may hold Drafts whatever its visibility, so the line is present
 * on a private one too — it tells the member how much of the list is off the
 * Catalogue's page before they decide to publish. It follows curation because
 * the page re-reads the works it lists.
 */
const draftCountLine = (count: number): string =>
  count === 1
    ? "1 artwork in this selection is a draft."
    : `${count} artworks in this selection are drafts.`;

const thumbnailSrc = (artwork: Artwork): string | null =>
  primaryPhotoUrl(artwork, "square_sm");

/**
 * One row: the handle, the work's thumbnail, title and artist, the Draft badge
 * when it has one, and the remove control.
 *
 * The handle is the sortable activator rather than the row itself, so a click
 * on the row's text is never a drag and nothing about the work's title becomes
 * a control. Its label carries the work's title and its position, which is the
 * only way a screen reader can tell twelve image rows apart.
 */
const SortableWorkRow: React.FC<{
  artwork: Artwork;
  position: number;
  total: number;
  busy: boolean;
  onRemove: () => void;
}> = ({ artwork, position, total, busy, onRemove }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: artwork.id });
  const src = thumbnailSrc(artwork);
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        listStyle: "none",
      }}
    >
      <Paper
        withBorder
        p="sm"
        style={{
          opacity: isDragging ? 0.6 : 1,
          // The lifted row is above its siblings while it moves.
          position: "relative",
          zIndex: isDragging ? 1 : undefined,
        }}
      >
        <Group wrap="nowrap" gap="md">
          <ActionIcon
            ref={setActivatorNodeRef}
            variant="subtle"
            color="gray"
            aria-label={`Reorder ${artwork.title}, position ${position} of ${total}`}
            style={{ cursor: "grab" }}
            {...attributes}
            {...listeners}
          >
            <IconGripVertical size={18} />
          </ActionIcon>
          {src ? (
            <Image src={src} alt="" w={56} h={56} fit="cover" radius="sm" />
          ) : (
            <Box
              w={56}
              h={56}
              style={{
                borderRadius: "var(--mantine-radius-sm)",
                background: "var(--mantine-color-gray-1)",
              }}
            />
          )}
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" wrap="wrap">
              <Text fw={600} lineClamp={1}>
                {artwork.title}
              </Text>
              {artwork.status === "draft" ? <DraftBadge /> : null}
            </Group>
            <Text size="sm" c="dimmed" lineClamp={1}>
              {artwork.artistName}
            </Text>
          </Box>
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label={`Remove ${artwork.title}`}
            disabled={busy}
            onClick={onRemove}
          >
            <IconTrash size={18} />
          </ActionIcon>
        </Group>
      </Paper>
    </li>
  );
};

interface AddWorksModalProps {
  opened: boolean;
  onClose: () => void;
  catalogueId: string;
  selectionId: string;
  existingIds: string[];
  onAdded: () => Promise<void> | void;
}

/**
 * The picker: the Catalogue's live works, minus the ones already curated, in
 * the order they are checked.
 *
 * It loads when it opens rather than with the page, so the manage page pays
 * nothing for a list nobody asked to see, and it seeds the exclusion from the
 * works the page already holds — offering a work twice would be a write that
 * cannot change anything. The shell mounts its body only while the modal is
 * open, so every opening starts clean: no reset effect, and no half-typed
 * choice surviving the last visit.
 */
const AddWorksModal: React.FC<AddWorksModalProps> = (props) => (
  <Modal
    opened={props.opened}
    onClose={props.onClose}
    title="Add artworks"
    centered
    size="lg"
  >
    {props.opened ? <AddWorksBody {...props} /> : null}
  </Modal>
);

const AddWorksBody: React.FC<AddWorksModalProps> = ({
  onClose,
  catalogueId,
  selectionId,
  existingIds,
  onAdded,
}) => {
  const [options, setOptions] = useState<Artwork[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void artworkService
      .getCatalogueArtworks(catalogueId)
      .then((artworks) => {
        if (cancelled) return;
        const existing = new Set(existingIds);
        setOptions(artworks.filter((artwork) => !existing.has(artwork.id)));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("Error loading the catalogue's works:", err);
        setError("Could not load this catalogue’s artworks. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [catalogueId, existingIds]);

  const add = async () => {
    if (chosen.length === 0) return;
    setSaving(true);
    try {
      await selectionService.addWorks(catalogueId, selectionId, chosen);
      await onAdded();
      onClose();
      notifications.show({
        color: "green",
        title: "Added",
        message:
          chosen.length === 1
            ? "1 artwork was added to the selection."
            : `${chosen.length} artworks were added to the selection.`,
      });
    } catch (err) {
      console.error("Error adding works to the selection:", err);
      setError(
        "Could not add those artworks. Nothing was changed — try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        These are the catalogue&rsquo;s live artworks. A draft is added the same
        way and shows a badge on this page.
      </Text>
      {error ? <Alert color="red">{error}</Alert> : null}
      {loading ? (
        <Loader />
      ) : options.length === 0 ? (
        <Text>
          Every artwork in this catalogue is already in the selection.
        </Text>
      ) : (
        <ScrollArea.Autosize mah={360} type="auto">
          <Stack gap="xs">
            {options.map((artwork) => (
              <Checkbox
                key={artwork.id}
                checked={chosen.includes(artwork.id)}
                onChange={(event) => {
                  // Read the control's state now: the updater below runs
                  // later, when a synthetic event's `currentTarget` is gone.
                  const checked = event.currentTarget.checked;
                  setChosen((current) =>
                    checked
                      ? [...current, artwork.id]
                      : current.filter((id) => id !== artwork.id),
                  );
                }}
                label={
                  <Group gap="xs" wrap="wrap">
                    <Text size="sm">{artwork.title}</Text>
                    <Text size="xs" c="dimmed">
                      {artwork.artistName}
                    </Text>
                    {artwork.status === "draft" ? <DraftBadge /> : null}
                  </Group>
                }
              />
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => void add()}
          loading={saving}
          disabled={chosen.length === 0 || loading}
        >
          Add artworks
        </Button>
      </Group>
    </Stack>
  );
};

const SelectionWorksList: React.FC<SelectionWorksListProps> = ({
  catalogueId,
  selectionId,
  works,
  onChanged,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // A keyboard sensor as well as the pointer one: the order is the content, so
  // it has to be arrangeable without a mouse. `sortableKeyboardCoordinates` is
  // what makes space/enter pick a row up and the arrows move it.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ids = useMemo(() => works.map((artwork) => artwork.id), [works]);
  const draftCount = works.filter((work) => work.status === "draft").length;

  // The one write: state the whole list, re-read, then say what happened. The
  // reorder and the remove differ only in the list they compute, so they cannot
  // drift on ordering, on error copy or on when the toast fires.
  const writeOrder = async (
    nextIds: string[],
    done: { title: string; message: string },
    failed: string,
  ) => {
    setBusy(true);
    try {
      await selectionService.replaceWorks(catalogueId, selectionId, nextIds);
      await onChanged();
      notifications.show({ color: "green", ...done });
    } catch (err) {
      console.error("Error saving the selection's works:", err);
      notifications.show({
        color: "red",
        title: "Save failed",
        message: failed,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const next = moveWorkIds(ids, String(active.id), String(over.id));
    if (next.every((id, index) => id === ids[index])) return;
    void writeOrder(
      next,
      { title: "Reordered", message: "The selection opens in this order now." },
      "Could not save the new order. Nothing was changed — try again.",
    );
  };

  const remove = (artwork: Artwork) => {
    void writeOrder(
      ids.filter((id) => id !== artwork.id),
      {
        title: "Removed",
        message: `“${artwork.title}” was removed from this selection. The work itself is untouched.`,
      },
      "Could not remove that work. Nothing was changed — try again.",
    );
  };

  return (
    <Paper withBorder p="lg">
      <Stack gap="md">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Group gap="sm">
            <Text size="h3">Artworks</Text>
            {works.length > 0 ? (
              <Text size="sm" c="dimmed">
                {works.length} artwork{works.length === 1 ? "" : "s"}
              </Text>
            ) : null}
          </Group>
          {works.length > 0 ? (
            <Button
              variant="light"
              leftSection={<IconLibraryPlus size={16} />}
              onClick={() => setPickerOpen(true)}
            >
              Add artworks
            </Button>
          ) : null}
        </Group>

        {draftCount > 0 ? (
          <Text size="sm" c="dimmed">
            {draftCountLine(draftCount)}
          </Text>
        ) : null}

        {works.length === 0 ? (
          <Stack gap="xs" py="md">
            <Text fw={600}>No artworks yet</Text>
            <Text size="sm" c="dimmed">
              Add the artworks this selection should show. The order here is the
              order a reader sees.
            </Text>
            <Group>
              <Button
                variant="default"
                leftSection={<IconLibraryPlus size={16} />}
                onClick={() => setPickerOpen(true)}
              >
                Add artworks
              </Button>
            </Group>
          </Stack>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <Stack gap="xs" component="ul" style={{ padding: 0 }}>
                {works.map((artwork, index) => (
                  <SortableWorkRow
                    key={artwork.id}
                    artwork={artwork}
                    position={index + 1}
                    total={works.length}
                    busy={busy}
                    onRemove={() => remove(artwork)}
                  />
                ))}
              </Stack>
            </SortableContext>
          </DndContext>
        )}
      </Stack>

      <AddWorksModal
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        catalogueId={catalogueId}
        selectionId={selectionId}
        existingIds={ids}
        onAdded={onChanged}
      />
    </Paper>
  );
};

export default SelectionWorksList;
