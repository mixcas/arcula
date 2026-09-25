import React, { useState } from "react";
import {
  Container,
  Text,
  Button,
  Group,
  Card,
  Avatar,
  PasswordInput,
} from "@mantine/core";
import { Carousel } from "@mantine/carousel";

import { Link, useParams } from "react-router-dom";

const PublicCollectionPage: React.FC = () => {
  const { collectionId } = useParams<{ collectionId: string }>();
  const [viewMode, setViewMode] = useState<"list" | "mosaic">("list");
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [password, setPassword] = useState("");

  // Simulated collection data
  const collection = {
    id: collectionId,
    name: "My First Collection",
    isPublic: true,
    isPrivate: false,
    passwordProtected: false,
  };

  // Simulated artworks data
  const artworks = [
    {
      id: "1",
      title: "Starry Night",
      artistName: "Vincent van Gogh",
      date: "1889",
      photos: ["/path/to/photo1.jpg", "/path/to/photo2.jpg"],
      notes: "This is a famous painting by Van Gogh.",
    },
    {
      id: "2",
      title: "Mona Lisa",
      artistName: "Leonardo da Vinci",
      date: "1503",
      photos: ["/path/to/photo3.jpg"],
      notes: "Iconic portrait by Leonardo da Vinci.",
    },
  ];

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Logic to check password would go here
    console.log("Attempting to access with password:", password);
    setShowPasswordPrompt(false);
    // In a real app, we would verify the password and set authentication state
  };

  return (
    <Container size="sm" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Group mb="xl">
        <Text size="h2">{collection.name}</Text>
        <Group>
          <Button
            variant="outline"
            onClick={() => setViewMode(viewMode === "list" ? "mosaic" : "list")}
          >
            {viewMode === "list"
              ? "Switch to Mosaic View"
              : "Switch to List View"}
          </Button>
        </Group>
      </Group>

      {/* Password prompt modal */}
      {showPasswordPrompt && (
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
      )}

      {/* Collection content */}
      {collection.isPrivate ? (
        <Text>This collection is private.</Text>
      ) : collection.passwordProtected && showPasswordPrompt ? (
        /* Password prompt already shown above */
        <Text>Enter the password to view this collection.</Text>
      ) : (
        <>
          {viewMode === "list" ? (
            <div>
              {artworks.map((artwork) => (
                <Card key={artwork.id} shadow="sm" p="lg" mb="md">
                  <Group mb="md">
                    <div>
                      <Text size="h3">{artwork.title}</Text>
                      <Text>{artwork.artistName}</Text>
                      <Text>{artwork.date}</Text>
                    </div>
                  </Group>

                  {artwork.photos && artwork.photos.length > 0 && (
                    <Carousel
                      withIndicators
                      style={{ marginBottom: "1rem" }}
                      height={200}
                    >
                      {artwork.photos.map((photo, index) => (
                        <Carousel.Slide key={index}>
                          <Avatar
                            src={photo}
                            alt={artwork.title}
                            size="xl"
                            radius="xl"
                          />
                        </Carousel.Slide>
                      ))}
                    </Carousel>
                  )}

                  <Text>{artwork.notes}</Text>
                </Card>
              ))}
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
                  <Avatar
                    src={
                      artwork.photos && artwork.photos.length > 0
                        ? artwork.photos[0]
                        : undefined
                    }
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
        </>
      )}

      {!collection.isPrivate && !collection.passwordProtected && (
        <Group mt="xl">
          <Button component={Link} to="/login" variant="outline">
            Login to manage this collection
          </Button>
        </Group>
      )}
    </Container>
  );
};

export default PublicCollectionPage;
