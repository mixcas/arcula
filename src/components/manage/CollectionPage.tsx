import React, { useState, useEffect } from "react";
import { Text, Button, Group, Card } from "@mantine/core";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collectionService } from "@/services/collectionService";
import { artworkService } from "@/services/artworkService";
import { artworkSlug, collectionSlug, parseId } from "@/utils/slug";
import type { Artwork, Collection } from "@/types";

const CollectionPage: React.FC = () => {
  const { collectionId: param } = useParams<{ collectionId: string }>();
  // Routes carry "{slug}-{id}" but Firestore needs the id alone. Parsing down
  // to the id — rather than using the raw param — is what lets the canonical
  // rewrite below change the URL without re-triggering the fetch.
  const collectionId = parseId(param ?? "");
  const navigate = useNavigate();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCollectionData = async () => {
      if (!collectionId) return;

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

        // Fetch artworks for this collection
        const fetchedArtworks =
          await artworkService.getCollectionArtworks(collectionId);
        setArtworks(fetchedArtworks);

        setLoading(false);
      } catch (err) {
        console.error("Error fetching collection data:", err);
        setError("Failed to fetch collection data");
        setLoading(false);
      }
    };

    void fetchCollectionData();
  }, [collectionId]);

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

      {artworks.length === 0 ? (
        <Text ta="center">No artworks in this collection yet.</Text>
      ) : (
        <div>
          {artworks.map((artwork) => (
            <Card key={artwork.id} shadow="sm" p="lg" mb="md">
              <Group justify="space-between">
                <div>
                  <Text size="h3">{artwork.title}</Text>
                  <Text>{artwork.artistName}</Text>
                  <Text>{artwork.dateOfCreation}</Text>
                  {artwork.editions ? (
                    <Text>Editions: {artwork.editions}</Text>
                  ) : null}
                  {artwork.provenance ? (
                    <Text>Provenance: {artwork.provenance}</Text>
                  ) : null}
                </div>
                <Button
                  component={Link}
                  to={`/manage/collection/${param}/artwork/${artworkSlug(artwork.title, artwork.id)}`}
                >
                  Edit
                </Button>
              </Group>
            </Card>
          ))}
        </div>
      )}
    </>
  );
};

export default CollectionPage;
