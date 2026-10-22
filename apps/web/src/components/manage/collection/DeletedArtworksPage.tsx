import React, { useEffect, useState } from "react";
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
import { parseId, primaryPhotoUrl, timestampMillis } from "@arcula/shared";
import type { Artwork, Timestamp } from "@arcula/shared";

// Deletion time is read as a distance ("2 days ago"), with the exact instant
// on hover and in the `<time>` element. A list sorted by recency is easier to
// scan by distance than by a column of timestamps.
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

const relativeTime = (deletedAt: Timestamp): string => {
  const distance = timestampMillis(deletedAt) - Date.now();
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(distance) >= size) {
      return relative.format(Math.round(distance / size), unit);
    }
  }
  return relative.format(Math.round(distance / 1000), "second");
};

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
  const [loadError, setLoadError] = useState(false);
  // One restore at a time: a row's button reports its own progress, and the
  // other rows are held while it is in flight so a double click cannot write
  // the same restore twice.
  const [restoringId, setRestoringId] = useState<string | null>(null);

  // The initial read lives inside the effect (as the other manage pages do)
  // so the page settles once; `refresh` is the same read for a retry and for
  // the refetch after a restore.
  useEffect(() => {
    const fetchDeleted = async () => {
      if (!collectionId) return;
      try {
        setArtworks(await artworkService.getDeletedArtworks(collectionId));
        setLoadError(false);
      } catch (err) {
        console.error("Error fetching deleted artworks:", err);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };
    void fetchDeleted();
  }, [collectionId]);

  const refresh = async () => {
    try {
      setArtworks(await artworkService.getDeletedArtworks(collectionId));
      setLoadError(false);
    } catch (err) {
      console.error("Error fetching deleted artworks:", err);
      setLoadError(true);
    }
  };

  const retry = () => {
    setLoading(true);
    void refresh().finally(() => setLoading(false));
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
      await refresh();
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
          disabled={restoringId !== null && restoringId !== artwork.id}
        >
          Restore
        </Button>
      ),
    },
  ];

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
      ) : loadError ? (
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
        <DataTable<Artwork>
          idAccessor="id"
          records={artworks}
          columns={columns}
          withTableBorder
          highlightOnHover
          striped={false}
          minHeight={200}
        />
      )}
    </Stack>
  );
};

export default DeletedArtworksPage;
