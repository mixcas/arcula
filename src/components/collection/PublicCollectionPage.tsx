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
import { isPermissionDenied } from "@/utils/firestoreErrors";
import { photoUrl, sortPhotos } from "@/utils/artworkPhotos";
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
  // Rules deny the read of a private collection outright (firestore.rules).
  // The denied case is its own state — not `error` — so the page can render
  // the private message instead of a failure alert.
  const [denied, setDenied] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "mosaic">("list");
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [password, setPassword] = useState("");

  // createCollection defaults isPublic to true, so a fresh collection is
  // publicly reachable unless the owner makes it private; a collection written
  // before the field existed reads as private. This check is a rendering gate,
  // not access control: Firestore rules deny the underlying read of a private
  // collection outright, and a denied read is mapped to this same private state
  // in the fetch effect. An unauthenticated visitor can only ever fetch one
  // published collection, and even then only its public artworks (see the
  // sequencing in the fetch effect).
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
        // never requested at all — the rules deny the collection read before
        // this point, so a an anonymous visitor cannot even pull a private
        // collection's name down. For a published collection this second round
        // trip fetches only the works the owner marked public. Costs one round
        // trip, and it is the natural order anyway since the header needs the
        // collection before anything else can render.
        if (fetched.isPublic !== true) {
          return;
        }

        const fetchedArtworks =
          await artworkService.getPublicCollectionArtworks(collectionId);
        // Sorted here rather than with orderBy: the service query carries two
        // where() constraints, and adding an orderBy on a different field
        // would require yet another composite index. title is required on
        // Artwork, so it is always safe to compare.
        setArtworks(
          [...fetchedArtworks].sort((a, b) => a.title.localeCompare(b.title)),
        );
      } catch (err) {
        console.error("Error fetching public collection:", err);
        // A denied read is the rules doing their job — the collection is
        // private — not a failure. Map it to the private state below.
        if (isPermissionDenied(err)) {
          setDenied(true);
        } else {
          setError("Failed to load this collection. Please try again.");
        }
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

  /**
   * The mosaic's image URLs, in the artwork's own order.
   *
   * `square_lg` rather than the original: this is a grid of fixed-size tiles,
   * and every one of them pulling a 12-megapixel source is a page that never
   * finishes loading. `photoUrls` falls back to the original per photo, so a
   * work whose variant failed to generate still shows something.
   */
  const photoUrlsOf = (artwork: Artwork): string[] =>
    sortPhotos(artwork.photos).flatMap((photo) => {
      const url = photoUrl(photo, "square_lg");
      return url ? [url] : [];
    });

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
      ) : !collection && !denied ? (
        <Alert color="red">Collection not available</Alert>
      ) : !isPublic ? (
        <Text>This collection is private.</Text>
      ) : artworks.length === 0 ? (
        <Text ta="center">No public artworks in this collection yet.</Text>
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
