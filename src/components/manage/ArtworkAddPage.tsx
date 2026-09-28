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
  Alert,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { artworkService } from "@/services/artworkService";
import type { Artwork } from "@/types";
// Subpath imports keep lodash out of the main bundle path; prefer these over
// full-package imports (AGENTS.md).
import mapValues from "lodash/mapValues";
import omitBy from "lodash/omitBy";

/**
 * Parse a numeric form field. Returns undefined for blank or unparseable input
 * so the key is omitted from the document rather than written as 0 or NaN.
 * A real 0 is preserved, keeping "worth zero" distinct from "not set".
 */
const toNumber = (value: string): number | undefined => {
  if (value.trim() === "") {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const ArtworkAddPage: React.FC = () => {
  const { collectionId } = useParams<{ collectionId: string }>();
  const { currentUser } = useAuth();
  const navigate = useNavigate();

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!collectionId) {
      setError("Invalid collection id");
      return;
    }

    if (!currentUser) {
      setError("You must be signed in to add an artwork");
      return;
    }

    const title = formData.title.trim();
    const artistName = formData.artistName.trim();

    if (!title || !artistName) {
      setError("Title and artist name are required");
      return;
    }

    setSubmitting(true);
    setError(null);

    // Trim every string field, then coerce the two numeric ones. Must stay a
    // non-lodash trim and toNumber: passing `trim` straight to mapValues would
    // feed the field name into lodash's `chars` param, and `_.toNumber("")`
    // returns 0, silently turning blanks into zeros.
    const values = {
      ...mapValues(formData, (v) => v.trim()),
      acquisitionPrice: toNumber(formData.acquisitionPrice),
      currentValue: toNumber(formData.currentValue),
    };

    try {
      const artwork: Omit<Artwork, "id"> = {
        title: values.title,
        artistName: values.artistName,
        // Stored in the "{urlized-name}-{docId}" form defined in FULLSPEC §10.
        // Read paths must query artworks by this same composite value.
        collectionId,
        userId: currentUser.uid,
        // TODO: upload to Firebase Storage per FULLSPEC §8 and store the
        // resulting FileReferences once a storage service exists.
        certificates: [],
        photos: [],
        // Blank strings and absent numbers are dropped entirely so "not set"
        // stays distinguishable from set-but-empty. The predicate is explicit
        // (`=== "" || === undefined`) rather than truthiness-based because a
        // real 0 must survive.
        ...omitBy(values, (v) => v === "" || v === undefined),
      };

      const newId = await artworkService.createArtwork(artwork);
      void navigate(`/manage/collection/${collectionId}/artwork/${newId}`);
    } catch (err) {
      console.error("Error creating artwork:", err);
      setError("Failed to create artwork. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container size="sm" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Text size="h2" mb="xl">
        Add New Artwork
      </Text>

      <Card shadow="sm" p="lg">
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
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
            value={formData.acquisitionDate || null}
            onChange={(date) => handleChange("acquisitionDate", date ?? "")}
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
            disabled
            description="File uploads are not wired up yet"
            mb="md"
          />

          <FileInput
            label="Photos"
            placeholder="Upload JPG, PNG, WebP images"
            multiple
            accept="image/jpeg,image/png,image/webp"
            value={photos}
            onChange={(files) => handleFileChange(files, "photos")}
            disabled
            description="File uploads are not wired up yet"
            mb="md"
          />

          {error ? (
            <Alert color="red" mb="md">
              {error}
            </Alert>
          ) : null}

          <Group mt="xl">
            <Button type="submit" loading={submitting}>
              Save Artwork
            </Button>
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
