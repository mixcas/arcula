import React, { useState } from "react";
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

const ArtworkAddPage: React.FC = () => {
  const { collectionId } = useParams<{ collectionId: string }>();

  const [formData, setFormData] = useState({
    title: "",
    serie: "",
    artistName: "",
    dateOfCreation: "",
    media: "",
    dimensions: "",
    editions: "",
    acquisitionDate: "",
    acquisitionPrice: "",
    placeOfOrigin: "",
    provenance: "",
    notes: "",
    condition: "",
    currentValue: "",
  });

  const [certificates, setCertificates] = useState<File[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);

  const handleChange = (name: string, value: string) => {
    setFormData({
      ...formData,
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
    console.log("Form submitted:", { ...formData, certificates, photos });
  };

  return (
    <Container size="sm" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Text size="h2" mb="xl">
        Add New Artwork
      </Text>

      <Card shadow="sm" p="lg">
        <form onSubmit={handleSubmit}>
          <TextInput
            label="Title"
            placeholder="Artwork title"
            value={formData.title}
            onChange={(e) => handleChange("title", e.target.value)}
            required
            mb="md"
          />

          <TextInput
            label="Serie"
            placeholder="Serie name"
            value={formData.serie}
            onChange={(e) => handleChange("serie", e.target.value)}
            mb="md"
          />

          <TextInput
            label="Artist Name"
            placeholder="Artist's full name"
            value={formData.artistName}
            onChange={(e) => handleChange("artistName", e.target.value)}
            required
            mb="md"
          />

          <TextInput
            label="Date of Creation"
            placeholder="YYYY-MM-DD"
            value={formData.dateOfCreation}
            onChange={(e) => handleChange("dateOfCreation", e.target.value)}
            mb="md"
          />

          <TextInput
            label="Media"
            placeholder="e.g. Oil on canvas, Bronze, Mixed media"
            value={formData.media}
            onChange={(e) => handleChange("media", e.target.value)}
            mb="md"
          />

          <TextInput
            label="Dimensions"
            placeholder="e.g. 100x80 cm"
            value={formData.dimensions}
            onChange={(e) => handleChange("dimensions", e.target.value)}
            mb="md"
          />

          <TextInput
            label="Editions"
            placeholder="e.g. 3/10, Open edition"
            value={formData.editions}
            onChange={(e) => handleChange("editions", e.target.value)}
            mb="md"
          />

          <DateInput
            label="Acquisition Date"
            placeholder="Select date"
            value={
              formData.acquisitionDate
                ? new Date(formData.acquisitionDate)
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
              formData.acquisitionPrice
                ? parseFloat(formData.acquisitionPrice)
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
            value={formData.placeOfOrigin}
            onChange={(e) => handleChange("placeOfOrigin", e.target.value)}
            mb="md"
          />

          <TextInput
            label="Provenance"
            placeholder="Where acquired, e.g. Gallery, Auction, Private collection"
            value={formData.provenance}
            onChange={(e) => handleChange("provenance", e.target.value)}
            mb="md"
          />

          <Textarea
            label="Notes"
            placeholder="Additional information about the artwork"
            value={formData.notes}
            onChange={(e) => handleChange("notes", e.target.value)}
            mb="md"
          />

          <TextInput
            label="Condition"
            placeholder="Excellent, Good, Fair, etc."
            value={formData.condition}
            onChange={(e) => handleChange("condition", e.target.value)}
            mb="md"
          />

          <NumberInput
            label="Current Value"
            placeholder="Value in currency"
            value={
              formData.currentValue
                ? parseFloat(formData.currentValue)
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
            <Button type="submit">Save Artwork</Button>
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

export default ArtworkAddPage;
