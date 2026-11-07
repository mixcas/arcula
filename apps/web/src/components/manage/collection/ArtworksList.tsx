import React, { useMemo, useState } from "react";
import { Alert, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { artworkService } from "@/services/artworkService";
import ArtworksTable from "@/components/manage/collection/ArtworksTable";
import {
  RECORDS_PER_PAGE_OPTIONS,
  sortArtworks,
  type SortState,
} from "@/components/manage/collection/artworksSort";
import { parseId } from "@arcula/shared";
import type { Artwork } from "@arcula/shared";

// Stable id for the single delete dialog this list can have open. Passing it
// to openConfirmModal means a second click cannot stack a second dialog on top
// of the first (the modals manager ignores an OPEN for an id already in its
// state), and it is what the pending/error updates below address. It lives here
// rather than on the row that opens it, because a row delete and a bulk delete
// are the same dialog and the same write.
const DELETE_MODAL_ID = "delete-artworks";

export interface ArtworksListProps {
  artworks: Artwork[];
  /** The "{slug}-{id}" collection param, reused verbatim in the row links. */
  collectionParam: string;
  /** Refetch the list — called after a delete so the row disappears. */
  onDeleted: () => Promise<void> | void;
  /** The committed Collection search; "" (the default) means no search. */
  searchQuery?: string;
  /** A list read is in flight. The previous rows stay on screen. */
  fetching?: boolean;
  /** False until the first list read has answered, success or failure. */
  listSettled?: boolean;
  /** The list read failed; the previous rows stay when there are any. */
  searchError?: string | null;
  /** Ask for the current query's list again, after a failure. */
  onRetry?: () => void;
  /** Leave the search: remove `q` and show the whole collection. */
  onClearSearch?: () => void;
}

/**
 * The owner-facing artwork list: everything around the artworks themselves and
 * nothing about how they are drawn.
 *
 * It owns the count, the selection, the sort, the page and the page size, the
 * delete confirmation and the three states the collection page hands down
 * (fetching, not settled, failed) — so that a second presentation of the same
 * collection, added later, can be rendered from this one state instead of
 * keeping a parallel copy. `ArtworksTable` renders the page it is given.
 *
 * Three things about it are not obvious from the markup:
 *
 * - **The sort and the page are separate from the query.** A committed query is
 *   a fresh view — page 1, nothing selected, and a token that makes A→B→A count
 *   as two transitions rather than a return to A's old page — but the sort
 *   deliberately survives it: searching must not reorder the rows being read.
 * - **Sorting happens over the whole set.** The page is sliced from the sorted
 *   result; sorting the visible page instead would merely reorder one page and
 *   leave the collection in a nonsense order.
 * - **Deleting is a soft delete.** `deletedAt` is stamped server-side and the
 *   record is kept, which is why the delete is one bulk request rather than a
 *   row-per-call and why it is reversible later.
 */
const ArtworksList: React.FC<ArtworksListProps> = ({
  artworks,
  collectionParam,
  onDeleted,
  searchQuery = "",
  fetching = false,
  listSettled = true,
  searchError = null,
  onRetry,
  onClearSearch,
}) => {
  const queryKey = searchQuery.trim();
  const searchActive = queryKey !== "";

  // A committed query is a fresh view: page 1, nothing selected. The token
  // below is bumped on every transition, so A→B→A counts as two transitions
  // rather than a return to the page and selection A had before. Adjusting
  // state during render is React's supported pattern for state derived from
  // props; an effect would paint the previous query's page first.
  const [queryTransition, setQueryTransition] = useState({
    query: queryKey,
    token: 0,
  });
  let resetToken = queryTransition.token;
  if (queryTransition.query !== queryKey) {
    resetToken += 1;
    setQueryTransition({ query: queryKey, token: resetToken });
  }

  // Page and selection belong to that transition. The stored value still
  // carries the previous token, so it is simply not read. The sort is
  // deliberately outside this — searching must not reorder rows.
  const [pageState, setPageState] = useState({
    forToken: resetToken,
    page: 1,
  });
  const page = pageState.forToken === resetToken ? pageState.page : 1;

  const [recordsPerPage, setRecordsPerPage] = useState(
    RECORDS_PER_PAGE_OPTIONS[0],
  );
  const [sort, setSort] = useState<SortState>({
    field: "title",
    direction: "asc",
  });
  // Selected rows are held as ids, not as record objects: a refetch after a
  // delete replaces every object, and a selection keyed by identity would then
  // silently empty itself. Keyed by the transition for the same reason as the
  // page.
  const [selection, setSelection] = useState({
    forToken: resetToken,
    ids: [] as string[],
  });
  const selectedIds = useMemo(
    () => (selection.forToken === resetToken ? selection.ids : []),
    [selection, resetToken],
  );

  const sortedArtworks = useMemo(
    () => sortArtworks(artworks, sort),
    [artworks, sort],
  );
  const selectedRecords = useMemo(
    () => sortedArtworks.filter((artwork) => selectedIds.includes(artwork.id)),
    [sortedArtworks, selectedIds],
  );

  // Clamp the rendered page to the row count without a setState-in-effect
  // (flagged by the react-hooks rule): after a delete the list shows the
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
          The record is kept — this is a soft delete, so you can restore it from
          the collection's Deleted view.
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
          .softDeleteArtworks(parseId(collectionParam), ids)
          .then(async () => {
            setSelection({ forToken: resetToken, ids: [] });
            modals.close(DELETE_MODAL_ID);
            await onDeleted();
            notifications.show({
              color: "green",
              title: "Deleted",
              message:
                ids.length === 1
                  ? "The artwork was removed. You can restore it from the Deleted view."
                  : `${ids.length} artworks were removed. You can restore them from the Deleted view.`,
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

  // The table and a future grid share one delete flow, so a row's Delete names
  // the work it deletes and the parent owns the dialog — including which
  // transition the cleared selection belongs to.
  const confirmDeleteArtwork = (artwork: Artwork) =>
    confirmDelete([artwork.id], `"${artwork.title}"`);

  const countLabel = searchActive
    ? `Found ${artworks.length} artwork${artworks.length === 1 ? "" : "s"}`
    : `${artworks.length} artwork${artworks.length === 1 ? "" : "s"}`;

  // A completed search that matched nothing is its own answer, not an empty
  // collection; while the first read is still running neither is known, so
  // the list keeps its searching empty state.
  const noResults =
    listSettled &&
    searchActive &&
    !fetching &&
    artworks.length === 0 &&
    !searchError;
  // With no rows behind a failure there is nothing to keep, so the Alert
  // takes the list's place rather than sitting above an empty shell.
  const searchFailedWithoutRows = searchError !== null && artworks.length === 0;
  // Before the first read answers, "no works" is not known: the page is
  // loading. Only the answer afterwards may claim the collection is empty.
  const emptyLabel = !listSettled
    ? searchActive
      ? "Searching…"
      : "Loading artworks…"
    : searchActive
      ? "Searching…"
      : "No artworks in this collection yet.";

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Group gap="xs">
          {listSettled ? (
            <Text size="sm" c="dimmed">
              {countLabel}
              {selectedIds.length > 0
                ? ` — ${selectedIds.length} selected`
                : ""}
            </Text>
          ) : null}
          {fetching && artworks.length > 0 ? (
            <Text size="sm" c="dimmed">
              Updating results…
            </Text>
          ) : null}
        </Group>
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

      {searchError ? (
        <Alert color="red" title="Could not load artworks">
          <Group justify="space-between" wrap="wrap" gap="sm">
            <Text size="sm">{searchError}</Text>
            {onRetry ? (
              <Button size="compact-sm" variant="default" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </Group>
        </Alert>
      ) : null}

      {noResults ? (
        <Paper p="xl" ta="center">
          <Text>No artworks match “{queryKey}”.</Text>
          <Button mt="md" variant="default" onClick={onClearSearch}>
            Clear search
          </Button>
        </Paper>
      ) : null}

      {searchFailedWithoutRows || noResults ? null : (
        <ArtworksTable
          records={pageRecords}
          selectedRecords={selectedRecords}
          onSelectionChange={(ids) =>
            setSelection({ forToken: resetToken, ids })
          }
          sort={sort}
          onSortChange={(next) => {
            setSort(next);
            // A new column rarely leaves the current offset in range, and
            // landing on an empty page reads as a bug.
            setPageState({ forToken: resetToken, page: 1 });
          }}
          page={effectivePage}
          onPageChange={(next) =>
            setPageState({ forToken: resetToken, page: next })
          }
          totalRecords={sortedArtworks.length}
          recordsPerPage={recordsPerPage}
          onRecordsPerPageChange={setRecordsPerPage}
          collectionParam={collectionParam}
          searchQuery={searchQuery}
          onConfirmDeleteArtwork={confirmDeleteArtwork}
          fetching={fetching}
          emptyLabel={emptyLabel}
        />
      )}
    </Stack>
  );
};

export default ArtworksList;
