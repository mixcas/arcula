import React, { useState, useEffect } from "react";
import {
  Container,
  Text,
  TextInput,
  NumberInput,
  Textarea,
  Button,
  Group,
  FileInput,
  Card,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { Link, useParams } from "react-router-dom";

const ArtworkEditPage: React.FC = () => {
  const { collectionId, artworkId } = useParams<{
    collectionId: string;
    artworkId: string;
  }>();

  // Simulated artwork data - in reality this would be fetched from the database
  const [artworkData, setArtworkData] = useState({
    title: "Starry Night",
    serie: "Night Skies",
    artistName: "Vincent van Gogh",
    dateOfCreation: "1889",
    medium: "Oil on canvas",
    dimensions: "73.7 x 92.1 cm",
    acquisitionDate: "2023-05-15",
    acquisitionPrice: "50000",
    placeOfOrigin: "France",
    notes: "This is a famous painting by Van Gogh.",
    condition: "Excellent",
    currentValue: "75000",
  });

  const [certificates, setCertificates] = useState<File[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);

  const handleChange = (name: string, value: string) => {
    setArtworkData({
      ...artworkData,
      [name]: value,
    });
  };

  const handleFileChange = (
    files: File[] | null,
    type: "certificates" | "photos",
  ) => {
    if (files && files.length > 0) {
      if (type === "certificates") {
        setCertificates(files);
      } else {
        setPhotos(files);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Form submission logic would go here
    console.log("Form submitted:", { ...artworkData, certificates, photos });
  };

  return (
    <Container size="sm" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Text size="h2" mb="xl">
        Edit Artwork
      </Text>

      <Card shadow="sm" p="lg">
        <form onSubmit={handleSubmit}>
          <TextInput
            label="Title"
            placeholder="Artwork title"
            value={artworkData.title}
            onChange={(e) => handleChange("title", e.target.value)}
            required
            mb="md"
          />

          <TextInput
            label="Serie"
            placeholder="Serie name"
            value={artworkData.serie}
            onChange={(e) => handleChange("serie", e.target.value)}
            mb="md"
          />

          <TextInput
            label="Artist Name"
            placeholder="Artist's full name"
            value={artworkData.artistName}
            onChange={(e) => handleChange("artistName", e.target.value)}
            required
            mb="md"
          />

          <TextInput
            label="Date of Creation"
            placeholder="YYYY-MM-DD"
            value={artworkData.dateOfCreation}
            onChange={(e) => handleChange("dateOfCreation", e.target.value)}
            mb="md"
          />

          <TextInput
            label="Medium"
            placeholder="Painting, Sculpture, etc."
            value={artworkData.medium}
            onChange={(e) => handleChange("medium", e.target.value)}
            mb="md"
          />

          <TextInput
            label="Dimensions"
            placeholder="e.g. 100x80 cm"
            value={artworkData.dimensions}
            onChange={(e) => handleChange("dimensions", e.target.value)}
            mb="md"
          />

          <DateInput
            label="Acquisition Date"
            placeholder="Select date"
            value={
              artworkData.acquisitionDate
                ? new Date(artworkData.acquisitionDate)
                : null
            }
            onChange={(date) =>
              handleChange("acquisitionDate", date?.toISOString() || "")
            }
            mb="md"
          />

          <NumberInput
            label="Acquisition Price"
            placeholder="Price in currency"
            value={
              artworkData.acquisitionPrice
                ? parseFloat(artworkData.acquisitionPrice)
                : undefined
            }
            onChange={(value) =>
              handleChange("acquisitionPrice", value?.toString() || "")
            }
            mb="md"
          />

          <TextInput
            label="Place of Origin"
            placeholder="City, Country"
            value={artworkData.placeOfOrigin}
            onChange={(e) => handleChange("placeOfOrigin", e.target.value)}
            mb="md"
          />

          <Textarea
            label="Notes"
            placeholder="Additional information about the artwork"
            value={artworkData.notes}
            onChange={(e) => handleChange("notes", e.target.value)}
            mb="md"
          />

          <TextInput
            label="Condition"
            placeholder="Excellent, Good, Fair, etc."
            value={artworkData.condition}
            onChange={(e) => handleChange("condition", e.target.value)}
            mb="md"
          />

          <NumberInput
            label="Current Value"
            placeholder="Value in currency"
            value={
              artworkData.currentValue
                ? parseFloat(artworkData.currentValue)
                : undefined
            }
            onChange={(value) =>
              handleChange("currentValue", value?.toString() || "")
            }
            mb="md"
          />

          <FileInput
            label="Certificates"
            placeholder="Upload PDF, JPG, PNG files"
            multiple
            accept="application/pdf,image/jpeg,image/png"
            value={certificates}
            onChange={(files) => handleFileChange(files, "certificates")}
            mb="md"
          />

          <FileInput
            label="Photos"
            placeholder="Upload JPG, PNG, WebP images"
            multiple
            accept="image/jpeg,image/png,image/webp"
            value={photos}
            onChange={(files) => handleFileChange(files, "photos")}
            mb="md"
          />

          <Group mt="xl">
            <Button type="submit">Save Changes</Button>
            <Button
              component={Link}
              to={`/manage/collection/${collectionId}`}
              variant="outline"
            >
              Cancel
            </Button>
          </Group>
        </form>
      </Card>
    </Container>
  );
};

export default ArtworkEditPage;
