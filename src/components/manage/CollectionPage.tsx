import React, { useState, useEffect, useCallback } from "react";
import { Text, Button, Group } from "@mantine/core";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { collectionService } from "@/services/collectionService";
import { artworkService } from "@/services/artworkService";
import { collectionSlug, parseId } from "@/utils/slug";
import ArtworksTable from "./collection/ArtworksTable";
import type { Artwork, Collection } from "@/types";

const CollectionPage: React.FC = () => {
  const { collectionId: param } = useParams<{ collectionId: string }>();
  // Routes carry "{slug}-{id}" but Firestore needs the id alone. Parsing down
  // to the id — rather than using the raw param — is what lets the canonical
  // rewrite below change the URL without re-triggering the fetch.
  const collectionId = parseId(param ?? "");
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const userId = currentUser?.uid;
  const [collection, setCollection] = useState<Collection | null>(null);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Split out of the effect below so the artwork table can ask for a refresh
  // after a delete. It reports its own failure rather than throwing: the table
  // awaits this as `onDeleted`, and a rejected promise there would be caught by
  // the delete's error handler and reported as a failed delete — which would be
  // a lie, since the write already went through.
  const loadArtworks = useCallback(async () => {
    if (!collectionId || !userId) return;
    try {
      // Scoped to the owner so the rules can authorize it with a plain userId
      // check; the owner sees every artwork, public or private, and never the
      // soft-deleted ones (the service filters those out).
      const fetchedArtworks = await artworkService.getCollectionArtworks(
        collectionId,
        userId,
      );
      setArtworks(fetchedArtworks);
      setError(null);
    } catch (err) {
      console.error("Error fetching artworks:", err);
      setError("Failed to fetch artworks");
    }
  }, [collectionId, userId]);

  useEffect(() => {
    const fetchCollectionData = async () => {
      if (!collectionId) return;
      if (!userId) return;

      try {
        // Fetch the collection
        const fetchedCollection =
          await collectionService.getCollection(collectionId);
        if (!fetchedCollection) {
          setError("Collection not found");
          setLoading(false);
          return;
        }

        setCollection(fetchedCollection);
        await loadArtworks();

        setLoading(false);
      } catch (err) {
        console.error("Error fetching collection data:", err);
        setError("Failed to fetch collection data");
        setLoading(false);
      }
    };

    void fetchCollectionData();
  }, [collectionId, userId, loadArtworks]);

  // Once the name is known, put the canonical "{slug}-{id}" in the address bar
  // so a link written with only the id still resolves to a readable URL.
  // `replace` swaps the current history entry, so Back returns to wherever the
  // user came from rather than to the un-slugged URL. Re-running is harmless:
  // the guard settles once the param matches, and a collection that failed to
  // load never reaches here.
  useEffect(() => {
    if (!param || !collection) {
      return;
    }
    const canonical = collectionSlug(collection.name, collection.id);
    if (canonical === param) {
      return;
    }
    void navigate(`/manage/collection/${canonical}`, { replace: true });
  }, [param, collection, navigate]);

  if (loading) {
    return <Text>Loading collection...</Text>;
  }

  if (error) {
    return <Text color="red">{error}</Text>;
  }

  if (!collection) {
    return <Text>Collection not found</Text>;
  }

  return (
    <>
      <Group justify="space-between" mb="xl">
        <Group>
          <Text size="h2">{collection.name}</Text>
          <Button variant="subtle" component={Link} to={`/collection/${param}`}>
            View
          </Button>
        </Group>
        <Group>
          <Button
            component={Link}
            to={`/manage/collection/${param}/artwork/add`}
          >
            Add Artwork
          </Button>
          <Button component={Link} to={`/manage/collection/${param}/settings`}>
            Settings
          </Button>
        </Group>
      </Group>

      <ArtworksTable
        artworks={artworks}
        collectionParam={param ?? ""}
        onDeleted={loadArtworks}
      />
    </>
  );
};

export default CollectionPage;
