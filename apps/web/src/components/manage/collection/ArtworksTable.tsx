import React, { useMemo, useState } from "react";
import { Alert, Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Link } from "react-router-dom";
import {
  DataTable,
  type DataTableColumn,
  type DataTableSortStatus,
} from "mantine-datatable";
import { artworkService } from "@/services/artworkService";
import ArtworkThumbnail from "@/components/manage/collection/ArtworkThumbnail";
import { artworkSlug, artworkSearchSuffix, parseId } from "@arcula/shared";
import type { Artwork } from "@arcula/shared";

// 25 first, so it is also the default: the state below is initialised from
// index 0, which keeps the default and the offered options from drifting.
// 10 is deliberately not offered — a 25-row page is the density these tables
// are read at, and a 10-row option only ever produced a page that looked empty
// next to a 50-row one.
const RECORDS_PER_PAGE_OPTIONS = [25, 50];

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
 * - **Deleting is a soft delete.** `deletedAt` is stamped server-side and the
 *   record is kept, which is why the delete is one bulk request rather than a
 *   row-per-call and why it is reversible later.
 * - **View leaves the app.** It is a `<Link>` to the public artwork page, not a
 *   route under `/manage`, so the collection's own skin decides what it looks
 *   like. The link still works for a private work or a private collection — the
 *   public page answers "this collection is private", which is the same thing
 *   the owner would see by pasting the URL.
 */
const ArtworksTable: React.FC<ArtworksTableProps> = ({
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
  // Edit returns to the search it came from; View is the public page and
  // deliberately does not. Built from `q` alone and encoded, so the row link
  // cannot smuggle another parameter back to the collection.
  const editSearchSuffix = artworkSearchSuffix(queryKey);

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
  const [sortStatus, setSortStatus] = useState<DataTableSortStatus<Artwork>>({
    columnAccessor: "title",
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

  const columns = useMemo<DataTableColumn<Artwork>[]>(
    () => [
      {
        // The thumbnail identifies a work before its title is read, and is not
        // a value to sort by: `sortable: false` keeps it out of the sort cycle,
        // which would otherwise order rows by their photo array.
        accessor: "photos",
        title: "",
        width: 72,
        sortable: false,
        render: (artwork) => <ArtworkThumbnail artwork={artwork} />,
      },
      {
        accessor: "title",
        title: "Title",
        // `sortable` is not the default: without it the header renders as
        // plain text and clicking it does nothing at all.
        sortable: true,
        // The status rides along in the title cell rather than claiming a
        // column of its own: it is an attribute of the work, and a third data
        // column for a single badge would crowd the actions. Only a draft is
        // marked — published is the ordinary case, and badging it would make
        // every row say the same thing.
        render: (artwork) => (
          <Group gap="xs" wrap="nowrap">
            <Text>{artwork.title}</Text>
            {artwork.status === "draft" ? (
              <Badge color="gray" variant="light" size="sm">
                Draft
              </Badge>
            ) : null}
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
            {/*
              The public page for a single artwork, in the collection's own
              skin. The API already serves a public, un-deleted artwork by id,
              so this link needs no server work at all — only a route and a
              view.

              A plain `href` rather than a router `Link`, because this leaves the
              app: the new tab gets a full document load, so a skin that somehow
              broke could not leave a half-working public page under the manage
              session's history. `noopener` is not optional — without it the
              opened page gets a handle on this window via `window.opener`.
            */}
            <Button
              size="compact-xs"
              variant="default"
              component="a"
              href={`/collection/${collectionParam}/artwork/${artworkSlug(
                artwork.title,
                artwork.id,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
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
              )}${editSearchSuffix}`}
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
    // confirmDelete is rebuilt every render; these are the values that change
    // what it closes over — the collection in the delete route, and the
    // transition the cleared selection belongs to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collectionParam, resetToken],
  );

  const countLabel = searchActive
    ? `Found ${artworks.length} artwork${artworks.length === 1 ? "" : "s"}`
    : `${artworks.length} artwork${artworks.length === 1 ? "" : "s"}`;

  // A completed search that matched nothing is its own answer, not an empty
  // collection; while the first read is still running neither is known, so
  // the table keeps its searching empty state.
  const noResults =
    listSettled &&
    searchActive &&
    !fetching &&
    artworks.length === 0 &&
    !searchError;
  // With no rows behind a failure there is nothing to keep, so the Alert
  // takes the table's place rather than sitting above an empty shell.
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
        <DataTable<Artwork>
          idAccessor="id"
          records={pageRecords}
          columns={columns}
          selectedRecords={selectedRecords}
          onSelectedRecordsChange={(records) =>
            setSelection({
              forToken: resetToken,
              ids: records.map((record) => record.id),
            })
          }
          sortStatus={sortStatus}
          onSortStatusChange={(status) => {
            setSortStatus(status);
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
          recordsPerPageOptions={RECORDS_PER_PAGE_OPTIONS}
          recordsPerPageLabel="Artworks per page"
          fetching={fetching}
          withTableBorder
          highlightOnHover
          striped={false}
          minHeight={200}
          emptyState={
            <Text p="xl" ta="center">
              {emptyLabel}
            </Text>
          }
        />
      )}
    </Stack>
  );
};

export default ArtworksTable;
