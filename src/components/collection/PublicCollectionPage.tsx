import React, { useEffect, useState } from "react";
import {
  Container,
  Text,
  Button,
  Group,
  Card,
  Avatar,
  PasswordInput,
  Loader,
  Alert,
  Skeleton,
} from "@mantine/core";
import { Carousel } from "@mantine/carousel";

import { Link, useNavigate, useParams } from "react-router-dom";

import { collectionService } from "@/services/collectionService";
import { artworkService } from "@/services/artworkService";
import { collectionSlug, parseId } from "@/utils/slug";
import type { Artwork, Collection } from "@/types";

const PublicCollectionPage: React.FC = () => {
  const { collectionId: param } = useParams<{ collectionId: string }>();
  // Routes carry "{slug}-{id}" but Firestore needs the id alone.
  const collectionId = parseId(param ?? "");
  const navigate = useNavigate();

  const [collection, setCollection] = useState<Collection | null>(null);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "mosaic">("list");
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [password, setPassword] = useState("");

  // createCollection defaults isPublic to false, so only an explicit true
  // grants access — a collection written before the field existed reads as
  // private. NOTE: this is a rendering gate, not access control. There are no
  // Firestore security rules in this repo, so the reads above are unguarded
  // and anyone who knows a document id can make them directly. This page is
  // the first unauthenticated reader in the app; see the sequencing in the
  // fetch effect for what that currently costs.
  const isPublic = collection?.isPublic === true;
  // Nothing writes passwordHash — CollectionSettingsPage saves only
  // {name, isPublic} — so this is currently always false. It is wired to the
  // real field rather than removed so the gate is already in the right place
  // when hashing lands. See handlePasswordSubmit for why it cannot be a
  // client-side check.
  const passwordProtected = Boolean(collection?.passwordHash);

  useEffect(() => {
    // The empty-param case is handled in the render body below rather than
    // here, so the effect never sets state synchronously.
    if (!collectionId) {
      return;
    }

    const fetchCollection = async () => {
      try {
        const fetched = await collectionService.getCollection(collectionId);
        if (!fetched) {
          setError("Collection not found");
          return;
        }
        setCollection(fetched);

        // Sequenced rather than parallel: a private collection's artworks are
        // never requested at all, so the only thing an unauthenticated visitor
        // can pull down for one is its name. This narrows the exposure but does
        // not close it — without security rules the collection document is
        // readable either way. Costs one round trip, and it is the natural
        // order anyway since the header needs the collection before anything
        // else can render.
        if (fetched.isPublic !== true) {
          return;
        }

        const fetchedArtworks =
          await artworkService.getCollectionArtworks(collectionId);
        // Sorted here rather than with orderBy: the service query is a where()
        // on collectionId, and adding an orderBy on a different field would
        // require a composite index. title is required on Artwork, so it is
        // always safe to compare.
        setArtworks(
          [...fetchedArtworks].sort((a, b) => a.title.localeCompare(b.title)),
        );
      } catch (err) {
        console.error("Error fetching public collection:", err);
        setError("Failed to load this collection. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    void fetchCollection();
  }, [collectionId]);

  // Put the canonical "{slug}-{id}" in the address bar — but only for a
  // collection the visitor is allowed to see. Rewriting first would write a
  // private collection's name into the URL and the browser history while the
  // body says it is private.
  useEffect(() => {
    if (!param || !collection || collection.isPublic !== true) {
      return;
    }
    const canonical = collectionSlug(collection.name, collection.id);
    if (canonical === param) {
      return;
    }
    void navigate(`/collection/${canonical}`, { replace: true });
  }, [param, collection, navigate]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: password protection (FULLSPEC §9). This cannot become a client-side
    // comparison — the artworks are already in the browser by this point, so a
    // prompt gates nothing and devtools walks straight past it. Real
    // enforcement needs Firestore rules plus a verification path, or a
    // callable/Cloud Function. Nothing writes passwordHash yet either.
    setShowPasswordPrompt(false);
  };

  /** Storage is not implemented, so a real artwork has no photos at all. */
  const photoUrlsOf = (artwork: Artwork): string[] =>
    artwork.photos.flatMap((photo) => (photo.url ? [photo.url] : []));

  return (
    <Container size="xl" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
      {isPublic ? (
        <Group mb="xl">
          <Text size="h2">{collection?.name}</Text>
          <Group>
            <Button
              variant="outline"
              onClick={() =>
                setViewMode(viewMode === "list" ? "mosaic" : "list")
              }
            >
              {viewMode === "list"
                ? "Switch to Mosaic View"
                : "Switch to List View"}
            </Button>
          </Group>
        </Group>
      ) : null}

      {/* Password prompt. Unreachable today: passwordProtected is always false
          and nothing sets showPasswordPrompt. Kept so the shape is already in
          place — see handlePasswordSubmit. */}
      {passwordProtected && showPasswordPrompt ? (
        <Card shadow="sm" p="lg" mb="md">
          <Text size="h3">Password Protected Collection</Text>
          <Text mb="md">
            Please enter the password to access this collection.
          </Text>

          <form onSubmit={handlePasswordSubmit}>
            <PasswordInput
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              mb="md"
            />

            <Group>
              <Button type="submit">Unlock Collection</Button>
              <Button
                variant="outline"
                onClick={() => setShowPasswordPrompt(false)}
              >
                Cancel
              </Button>
            </Group>
          </form>
        </Card>
      ) : null}

      {!collectionId ? (
        <Alert color="red">Invalid collection id</Alert>
      ) : loading ? (
        <Loader />
      ) : error ? (
        <Alert color="red">{error}</Alert>
      ) : !collection ? (
        <Alert color="red">Collection not available</Alert>
      ) : !isPublic ? (
        <Text>This collection is private.</Text>
      ) : artworks.length === 0 ? (
        <Text ta="center">No artworks in this collection yet.</Text>
      ) : viewMode === "list" ? (
        <div>
          {artworks.map((artwork) => {
            const photoUrls = photoUrlsOf(artwork);
            return (
              <Card key={artwork.id} shadow="sm" p="lg" mb="md">
                <Group mb="md">
                  <div>
                    <Text size="h3">{artwork.title}</Text>
                    <Text>{artwork.artistName}</Text>
                    {artwork.dateOfCreation ? (
                      <Text>{artwork.dateOfCreation}</Text>
                    ) : null}
                  </div>
                </Group>

                {/* `visible` renders the Carousel only when there is something
                    to show and a same-height block when there is not, so the
                    card does not resize between the two states. animate is off
                    because these placeholders are permanent, not pending —
                    shimmering would read as a page stuck loading. */}
                <Skeleton
                  visible={photoUrls.length > 0}
                  height={200}
                  mb="1rem"
                  animate={false}
                >
                  <Carousel withIndicators height={200}>
                    {photoUrls.map((url) => (
                      <Carousel.Slide key={url}>
                        <Avatar
                          src={url}
                          alt={artwork.title}
                          size="xl"
                          radius="xl"
                        />
                      </Carousel.Slide>
                    ))}
                  </Carousel>
                </Skeleton>

                {artwork.notes ? <Text>{artwork.notes}</Text> : null}
              </Card>
            );
          })}
        </div>
      ) : (
        <Group>
          {artworks.map((artwork) => (
            <Card
              key={artwork.id}
              shadow="sm"
              p="lg"
              style={{ width: "150px" }}
            >
              {/* No src means Mantine draws its own placeholder icon, which is
                  a better empty state than a grey circle would be. */}
              <Avatar
                src={photoUrlsOf(artwork)[0]}
                alt={artwork.title}
                size="xl"
                radius="xl"
                mb="md"
              />
              <Text size="sm">{artwork.title}</Text>
              <Text size="xs">{artwork.artistName}</Text>
            </Card>
          ))}
        </Group>
      )}

      {isPublic && !loading && !error ? (
        <Group mt="xl">
          <Button component={Link} to="/login" variant="outline">
            Login to manage this collection
          </Button>
        </Group>
      ) : null}
    </Container>
  );
};

export default PublicCollectionPage;
