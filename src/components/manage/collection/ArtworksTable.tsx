import React, { useMemo, useState } from "react";
import { Alert, Badge, Button, Group, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Link } from "react-router-dom";
import {
  DataTable,
  type DataTableColumn,
  type DataTableSortStatus,
} from "mantine-datatable";
import { artworkService } from "@/services/artworkService";
import { artworkSlug } from "@/utils/slug";
import type { Artwork } from "@/types";

const RECORDS_PER_PAGE_OPTIONS = [10, 25, 50];

// Stable id for the single delete dialog this component can have open. Passing
// it to openConfirmModal means a second click cannot stack a second dialog on
// top of the first (the modals manager ignores an OPEN for an id already in
// its state), and it is what the pending/error updates below address.
const DELETE_MODAL_ID = "delete-artworks";

// Titles are free text in any language, so sorting goes through a collator
// rather than `<`/`>`: `sensitivity: "base"` folds case and accents ("Dali" and
// "Dalí" land together), and `numeric: true` orders "Study 2" before
// "Study 10" instead of lexicographically after it.
const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

interface ArtworksTableProps {
  artworks: Artwork[];
  /** The "{slug}-{id}" collection param, reused verbatim in the row links. */
  collectionParam: string;
  /** Refetch the list — called after a delete so the row disappears. */
  onDeleted: () => Promise<void> | void;
}

/**
 * The owner-facing artwork list: a sortable, selectable datatable with
 * per-row View/Edit/Delete and a batch delete over the selection.
 *
 * Three things about this component are not obvious from the markup:
 *
 * - **The datatable neither sorts nor paginates.** It renders `records`
 *   verbatim and only uses `totalRecords` for the footer, so the caller sorts
 *   and slices. Sorting happens over the *whole* set and the page slice is cut
 *   from the sorted result — sorting the visible page instead would merely
 *   reorder one page and leave the collection in a nonsense order.
 * - **Deleting is a soft delete.** `deletedAt` is stamped and the record is
 *   kept, which is why the delete is a batch write rather than a `deleteDoc`
 *   and why it is reversible later. A future trash view will need no rules
 *   work: the owner branches of the artwork rules were left untouched.
 * - **View is disabled.** There is no public page for a single artwork yet
 *   (only the whole-collection page), so the button states the gap rather than
 *   linking nowhere.
 */
const ArtworksTable: React.FC<ArtworksTableProps> = ({
  artworks,
  collectionParam,
  onDeleted,
}) => {
  const [page, setPage] = useState(1);
  const [recordsPerPage, setRecordsPerPage] = useState(
    RECORDS_PER_PAGE_OPTIONS[0],
  );
  const [sortStatus, setSortStatus] = useState<DataTableSortStatus<Artwork>>({
    columnAccessor: "title",
    direction: "asc",
  });
  // Selected rows are held as ids, not as record objects: a refetch after a
  // delete replaces every object, and a selection keyed by identity would then
  // silently empty itself.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const sortedArtworks = useMemo(() => {
    const accessor = sortStatus.columnAccessor;
    const read = (artwork: Artwork): string => {
      const value = artwork[accessor as keyof Artwork];
      return typeof value === "string" ? value : "";
    };
    // The id tie-break keeps the order stable for equal values, so a
    // re-render (or two works sharing a title) never reshuffles rows.
    return [...artworks].sort((a, b) => {
      const result = collator.compare(read(a), read(b));
      if (result !== 0) {
        return sortStatus.direction === "asc" ? result : -result;
      }
      return a.id.localeCompare(b.id);
    });
  }, [artworks, sortStatus]);

  // Clamp the rendered page to the row count without a setState-in-effect
  // (flagged by the react-hooks rule): after a delete the table shows the
  // highest valid page until the user pages manually.
  const pageCount = Math.max(
    1,
    Math.ceil(sortedArtworks.length / recordsPerPage),
  );
  const effectivePage = Math.min(page, pageCount);
  const pageRecords = useMemo(
    () =>
      sortedArtworks.slice(
        (effectivePage - 1) * recordsPerPage,
        effectivePage * recordsPerPage,
      ),
    [sortedArtworks, effectivePage, recordsPerPage],
  );

  const selectedRecords = useMemo(
    () => sortedArtworks.filter((artwork) => selectedIds.includes(artwork.id)),
    [sortedArtworks, selectedIds],
  );

  // Asks for confirmation, then runs the delete. The modals manager closes the
  // dialog the moment Confirm is clicked and does not await whatever onConfirm
  // returns, so the pending state and the close are driven by hand here:
  // `closeOnConfirm: false` keeps the dialog up while the batch is in flight,
  // and both buttons are disabled for the duration so the write cannot be
  // triggered twice or abandoned half-committed.
  const confirmDelete = (ids: string[], label: string) => {
    modals.openConfirmModal({
      modalId: DELETE_MODAL_ID,
      title: "Delete artwork?",
      centered: true,
      closeOnConfirm: false,
      children: (
        <Text size="sm">
          {label} will be removed from this collection and from the public page.
          The record is kept — this is a soft delete, so it can be restored
          later.
        </Text>
      ),
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      // No onCancel handler on purpose: cancelling must leave the row
      // selection alone, or a misclick on "Delete selected" costs the user
      // their whole selection for nothing.
      onConfirm: () => {
        modals.updateModal({
          modalId: DELETE_MODAL_ID,
          children: <Text size="sm">Deleting…</Text>,
          cancelProps: { disabled: true },
          confirmProps: { color: "red", loading: true },
          closeOnClickOutside: false,
          closeOnEscape: false,
        });
        void artworkService
          .softDeleteArtworks(ids)
          .then(async () => {
            setSelectedIds([]);
            modals.close(DELETE_MODAL_ID);
            await onDeleted();
            notifications.show({
              color: "green",
              title: "Deleted",
              message:
                ids.length === 1
                  ? "The artwork was removed. The record is kept and can be restored."
                  : `${ids.length} artworks were removed. The records are kept and can be restored.`,
            });
          })
          .catch((error: unknown) => {
            // Leave the dialog open so the delete can be retried, and say why
            // it failed instead of closing on a silent no-op.
            console.error("Error deleting artworks:", error);
            modals.updateModal({
              modalId: DELETE_MODAL_ID,
              children: (
                <Alert color="red" title="Could not delete">
                  Nothing was deleted. Check your connection and try again.
                </Alert>
              ),
              cancelProps: {},
              confirmProps: { color: "red" },
              closeOnClickOutside: true,
              closeOnEscape: true,
            });
          });
      },
    });
  };

  const columns = useMemo<DataTableColumn<Artwork>[]>(
    () => [
      {
        accessor: "title",
        title: "Title",
        // `sortable` is not the default: without it the header renders as
        // plain text and clicking it does nothing at all.
        sortable: true,
        // The privacy flag rides along in the title cell rather than claiming a
        // column of its own: it is an attribute of the work, and a third
        // data column for a single badge would crowd the actions.
        render: (artwork) => (
          <Group gap="xs" wrap="nowrap">
            <Text>{artwork.title}</Text>
            {artwork.isPublic ? null : (
              <Badge color="gray" variant="light" size="sm">
                Private
              </Badge>
            )}
          </Group>
        ),
      },
      {
        accessor: "artistName",
        title: "Artist Name",
        sortable: true,
        render: (artwork) => <Text>{artwork.artistName}</Text>,
      },
      {
        // Actions, not data. The accessor is a placeholder — `sortable: false`
        // keeps the header out of the sort cycle — and the column is pinned so
        // the buttons stay reachable when a long title pushes the table
        // sideways.
        accessor: "actions",
        title: "",
        width: 220,
        sortable: false,
        pinned: "right",
        render: (artwork) => (
          <Group gap="xs" wrap="nowrap" justify="flex-end">
            <Button
              size="compact-xs"
              variant="default"
              disabled
              title="No public page for a single artwork yet"
            >
              View
            </Button>
            <Button
              size="compact-xs"
              variant="default"
              component={Link}
              to={`/manage/collection/${collectionParam}/artwork/${artworkSlug(
                artwork.title,
                artwork.id,
              )}`}
            >
              Edit
            </Button>
            <Button
              size="compact-xs"
              color="red"
              variant="light"
              onClick={() => confirmDelete([artwork.id], `"${artwork.title}"`)}
            >
              Delete
            </Button>
          </Group>
        ),
      },
    ],
    // confirmDelete is rebuilt every render; collectionParam is the only value
    // that changes what it closes over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collectionParam],
  );

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {artworks.length} artwork{artworks.length === 1 ? "" : "s"}
          {selectedIds.length > 0 ? ` — ${selectedIds.length} selected` : ""}
        </Text>
        {selectedIds.length > 0 ? (
          <Button
            color="red"
            variant="light"
            onClick={() =>
              confirmDelete(
                selectedIds,
                `${selectedIds.length} artwork${selectedIds.length === 1 ? "" : "s"}`,
              )
            }
          >
            Delete selected
          </Button>
        ) : null}
      </Group>

      <DataTable<Artwork>
        idAccessor="id"
        records={pageRecords}
        columns={columns}
        selectedRecords={selectedRecords}
        onSelectedRecordsChange={(records) =>
          setSelectedIds(records.map((record) => record.id))
        }
        sortStatus={sortStatus}
        onSortStatusChange={(status) => {
          setSortStatus(status);
          // A new column rarely leaves the current offset in range, and
          // landing on an empty page reads as a bug.
          setPage(1);
        }}
        page={effectivePage}
        onPageChange={setPage}
        totalRecords={sortedArtworks.length}
        recordsPerPage={recordsPerPage}
        onRecordsPerPageChange={setRecordsPerPage}
        recordsPerPageOptions={RECORDS_PER_PAGE_OPTIONS}
        recordsPerPageLabel="Artworks per page"
        withTableBorder
        highlightOnHover
        striped={false}
        minHeight={200}
        emptyState={
          <Text p="xl" ta="center">
            No artworks in this collection yet.
          </Text>
        }
      />
    </Stack>
  );
};

export default ArtworksTable;
