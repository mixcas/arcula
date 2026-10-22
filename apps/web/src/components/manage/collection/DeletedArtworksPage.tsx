import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Image,
  Loader,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Link, useParams } from "react-router-dom";
import { DataTable, type DataTableColumn } from "mantine-datatable";
import { artworkService } from "@/services/artworkService";
import { ApiRequestError } from "@/services/api";
import { relativeTime } from "@/utils/relativeTime";
import { parseId, primaryPhotoUrl, timestampMillis } from "@arcula/shared";
import type { Artwork } from "@arcula/shared";

/**
 * Why a read did not produce a list: the collection is refused or gone (403,
 * 404), or the request itself failed (no connection, 5xx). Only the second is
 * worth a Retry — asking again cannot change a refusal.
 */
type LoadFailure = "unavailable" | "transport";

/**
 * A collection's Deleted view: the works that carry a deletion stamp, most
 * recently deleted first, each with a Restore action.
 *
 * The order is the server's (`deletedAt` descending, then id) and the page
 * never sorts: "the work I just removed" is the reading this view exists for.
 * A restore asks for no confirmation — deleting it again is the undo — and
 * the page refetches rather than splicing its own list, so what is shown is
 * always what the server would answer.
 *
 * This table is deliberately not `ArtworksTable`: that one is sorted and
 * paginated over live works and its row action is Delete, so sharing it would
 * make delete and restore the same gesture with different meanings.
 */
const DeletedArtworksPage: React.FC = () => {
  const { collectionId: param } = useParams<{ collectionId: string }>();
  const collectionId = parseId(param ?? "");

  const [artworks, setArtworks] = useState<Artwork[]>([]);
  // A route without an id has nothing to fetch, so it starts settled rather
  // than spinning forever.
  const [loading, setLoading] = useState(collectionId !== "");
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  // One restore at a time: a row's button reports its own progress, and the
  // other rows are held while it is in flight so a double click cannot write
  // the same restore twice.
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // Selected rows are held as ids, not record objects, for the same reason the
  // live table does: a refetch replaces every object, and a selection keyed by
  // identity would silently empty itself.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [restoringSelected, setRestoringSelected] = useState(false);

  const selectedRecords = artworks.filter((artwork) =>
    selectedIds.includes(artwork.id),
  );

  // One read, used by the first load, the retry and every refetch after a
  // restore. Selecting by id means the prune below is needed on the first load
  // as much as on a refresh: a tick keyed by a row the server no longer lists
  // must never survive into a bulk action.
  const load = useCallback(async () => {
    if (!collectionId) return;
    try {
      const next = await artworkService.getDeletedArtworks(collectionId);
      setArtworks(next);
      setSelectedIds((ids) =>
        ids.filter((id) => next.some((artwork) => artwork.id === id)),
      );
      setLoadError(null);
    } catch (err) {
      console.error("Error fetching deleted artworks:", err);
      setLoadError(
        err instanceof ApiRequestError &&
          (err.status === 401 || err.status === 403 || err.status === 404)
          ? "unavailable"
          : "transport",
      );
    }
  }, [collectionId]);

  // The initial read lives inside the effect (as the other manage pages do)
  // so the page settles once.
  useEffect(() => {
    const fetchFirst = async () => {
      await load();
      setLoading(false);
    };
    void fetchFirst();
  }, [load]);

  const retry = () => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  };

  const restore = async (artwork: Artwork) => {
    setRestoringId(artwork.id);
    try {
      await artworkService.restoreArtwork(collectionId, artwork.id);
      notifications.show({
        color: "green",
        title: "Restored",
        message: `"${artwork.title}" is back in the collection.`,
      });
      await load();
    } catch (err) {
      // The row stays where it is: nothing was restored, so the retry is
      // simply clicking Restore again.
      console.error("Error restoring artwork:", err);
      notifications.show({
        color: "red",
        title: "Could not restore",
        message: "Nothing was restored. Check your connection and try again.",
      });
    } finally {
      setRestoringId(null);
    }
  };

  const restoreSelected = async () => {
    if (selectedIds.length === 0) return;
    setRestoringSelected(true);
    try {
      // The ids are the ticks, not the loaded page: the action restores
      // exactly what the member selected, and the toast reports what the
      // server moved rather than what was asked for.
      const { restored } = await artworkService.bulkRestoreArtworks(
        collectionId,
        selectedIds,
      );
      setSelectedIds([]);
      await load();
      notifications.show({
        color: "green",
        title: "Restored",
        message:
          restored === 0
            ? "Nothing needed restoring — those works are already back."
            : restored === 1
              ? "1 artwork is back in the collection."
              : `${restored} artworks are back in the collection.`,
      });
    } catch (err) {
      // Nothing moved, so the ticks stay: clicking the action again is the
      // retry.
      console.error("Error restoring artworks:", err);
      notifications.show({
        color: "red",
        title: "Could not restore",
        message: "Nothing was restored. Check your connection and try again.",
      });
    } finally {
      setRestoringSelected(false);
    }
  };

  const columns: DataTableColumn<Artwork>[] = [
    {
      accessor: "photos",
      title: "",
      width: 72,
      render: (artwork) => {
        const thumbnail = primaryPhotoUrl(artwork, "square_sm");
        return thumbnail ? (
          <Image
            src={thumbnail}
            alt={artwork.title}
            w={48}
            h={48}
            fit="cover"
            radius="sm"
          />
        ) : null;
      },
    },
    {
      accessor: "title",
      title: "Title",
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
      render: (artwork) => <Text>{artwork.artistName}</Text>,
    },
    {
      accessor: "deletedAt",
      title: "Deleted",
      width: 180,
      render: (artwork) => {
        if (!artwork.deletedAt) return null;
        const exact = new Date(
          timestampMillis(artwork.deletedAt),
        ).toLocaleString();
        return (
          <Tooltip label={exact} withArrow>
            <Text
              component="time"
              dateTime={new Date(
                timestampMillis(artwork.deletedAt),
              ).toISOString()}
              size="sm"
            >
              {relativeTime(artwork.deletedAt)}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      accessor: "actions",
      title: "",
      width: 110,
      pinned: "right",
      render: (artwork) => (
        <Button
          size="compact-xs"
          onClick={() => void restore(artwork)}
          loading={restoringId === artwork.id}
          disabled={
            restoringSelected ||
            (restoringId !== null && restoringId !== artwork.id)
          }
        >
          Restore
        </Button>
      ),
    },
  ];

  // A route with no id cannot name a collection to list. Say that instead of
  // falling through to the empty state, which would claim the collection has
  // nothing deleted.
  if (!collectionId) {
    return (
      <Alert color="red" title="No collection selected">
        <Text size="sm">
          The Deleted view belongs to a collection. Open it from the
          collection&rsquo;s page.
        </Text>
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Text size="h2">Deleted artworks</Text>
        <Button
          variant="default"
          component={Link}
          to={`/manage/collection/${param ?? ""}`}
        >
          Back to collection
        </Button>
      </Group>

      {loading ? (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      ) : loadError === "unavailable" ? (
        // A refusal is not a flaky connection: Retry cannot change it, so it
        // is not offered. The copy covers the missing collection and the
        // non-member alike, exactly as the server refuses both.
        <Alert color="red" title="Could not open this collection">
          <Text size="sm">
            This collection does not exist, or you do not have access to it.
          </Text>
        </Alert>
      ) : loadError === "transport" ? (
        <Alert color="red" title="Could not load deleted artworks">
          <Stack gap="sm" align="flex-start">
            <Text size="sm">
              The deleted works could not be fetched. Check your connection and
              try again.
            </Text>
            <Button variant="default" onClick={retry}>
              Retry
            </Button>
          </Stack>
        </Alert>
      ) : artworks.length === 0 ? (
        <Text c="dimmed">Nothing has been deleted from this collection.</Text>
      ) : (
        <Stack gap="md">
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {artworks.length} artwork{artworks.length === 1 ? "" : "s"}
              {selectedIds.length > 0
                ? ` — ${selectedIds.length} selected`
                : ""}
            </Text>
            {selectedIds.length > 0 ? (
              <Button
                onClick={() => void restoreSelected()}
                loading={restoringSelected}
                disabled={restoringSelected || restoringId !== null}
              >
                Restore selected
              </Button>
            ) : null}
          </Group>
          <DataTable<Artwork>
            idAccessor="id"
            records={artworks}
            columns={columns}
            selectedRecords={selectedRecords}
            onSelectedRecordsChange={(records) =>
              setSelectedIds(records.map((record) => record.id))
            }
            withTableBorder
            highlightOnHover
            striped={false}
            minHeight={200}
          />
        </Stack>
      )}
    </Stack>
  );
};

export default DeletedArtworksPage;
