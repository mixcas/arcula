import React, { useMemo } from "react";
import { Badge, Button, Group, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import {
  DataTable,
  type DataTableColumn,
  type DataTableSortStatus,
} from "mantine-datatable";
import ArtworkThumbnail from "@/components/manage/collection/ArtworkThumbnail";
import {
  RECORDS_PER_PAGE_OPTIONS,
  type SortState,
} from "@/components/manage/collection/artworksSort";
import { artworkSlug, artworkSearchSuffix } from "@arcula/shared";
import type { Artwork } from "@arcula/shared";

export interface ArtworksTableProps {
  /** The page slice, already sorted and cut by the list. */
  records: Artwork[];
  /** Every selected artwork, across pages — the datatable's controlled selection. */
  selectedRecords: Artwork[];
  /** The ids the selection now covers, handed back after a checkbox click. */
  onSelectionChange: (ids: string[]) => void;
  /** The list's shared sort, rendered as the datatable's controlled `sortStatus`. */
  sort: SortState;
  /** A header click, as the sort the list should hold next. */
  onSortChange: (sort: SortState) => void;
  page: number;
  onPageChange: (page: number) => void;
  totalRecords: number;
  recordsPerPage: number;
  onRecordsPerPageChange: (recordsPerPage: number) => void;
  /** The "{slug}-{id}" collection param, reused verbatim in the row links. */
  collectionParam: string;
  /** The committed Collection search; "" (the default) means no search. */
  searchQuery?: string;
  /** Ask the list to confirm and soft-delete one work. */
  onConfirmDeleteArtwork: (artwork: Artwork) => void;
  /** A list read is in flight. The previous rows stay on screen. */
  fetching?: boolean;
  /** What to say when this page has no rows. The list decides which state that is. */
  emptyLabel: React.ReactNode;
}

/**
 * One page of artworks as a sortable, selectable datatable.
 *
 * It is a renderer: the list above it owns the sort, the page, the page size,
 * the selection and the delete confirmation, and hands them all down. Two
 * things about it are not obvious from the markup:
 *
 * - **The datatable neither sorts nor paginates.** It renders `records`
 *   verbatim and only uses `totalRecords` for the footer, so the caller sorts
 *   and slices. The sort headers and the footer controls are controls only —
 *   they report a click and wait to be told the new state.
 * - **View leaves the app.** It is an `<a>` to the public artwork page, not a
 *   route under `/manage`, so the collection's own skin decides what it looks
 *   like. The link still works for a private work or a private collection — the
 *   public page answers "this collection is private", which is the same thing
 *   the owner would see by pasting the URL.
 */
const ArtworksTable: React.FC<ArtworksTableProps> = ({
  records,
  selectedRecords,
  onSelectionChange,
  sort,
  onSortChange,
  page,
  onPageChange,
  totalRecords,
  recordsPerPage,
  onRecordsPerPageChange,
  collectionParam,
  searchQuery = "",
  onConfirmDeleteArtwork,
  fetching = false,
  emptyLabel,
}) => {
  // Edit returns to the search it came from; View is the public page and
  // deliberately does not. Built from `q` alone and encoded, so the row link
  // cannot smuggle another parameter back to the collection.
  const editSearchSuffix = artworkSearchSuffix(searchQuery.trim());

  // The datatable addresses its columns by accessor; the list's sort names the
  // field. Memoised on the shared state, so the datatable sees a new status
  // only when the sort actually changes.
  const sortStatus = useMemo<DataTableSortStatus<Artwork>>(
    () => ({ columnAccessor: sort.field, direction: sort.direction }),
    [sort],
  );

  // The only two sortable columns are the two fields, so a reported accessor
  // is always one of them; anything else falls back to the default sort rather
  // than inventing a third.
  const handleSortStatusChange = (status: DataTableSortStatus<Artwork>) =>
    onSortChange({
      field: status.columnAccessor === "artistName" ? "artistName" : "title",
      direction: status.direction,
    });

  // The delete callback is rebuilt by the list on every render; these are the
  // values that change what the row closures depend on — the collection in the
  // links and the search they carry.
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
              onClick={() => onConfirmDeleteArtwork(artwork)}
            >
              Delete
            </Button>
          </Group>
        ),
      },
    ],
    [collectionParam, editSearchSuffix, onConfirmDeleteArtwork],
  );

  return (
    <DataTable<Artwork>
      idAccessor="id"
      records={records}
      columns={columns}
      selectedRecords={selectedRecords}
      onSelectedRecordsChange={(selected) =>
        onSelectionChange(selected.map((record) => record.id))
      }
      sortStatus={sortStatus}
      onSortStatusChange={handleSortStatusChange}
      page={page}
      onPageChange={onPageChange}
      totalRecords={totalRecords}
      recordsPerPage={recordsPerPage}
      onRecordsPerPageChange={onRecordsPerPageChange}
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
  );
};

export default ArtworksTable;
