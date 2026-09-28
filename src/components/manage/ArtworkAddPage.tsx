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
import { useForm } from "@mantine/form";
import { schemaResolver } from "@mantine/form";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { artworkService } from "@/services/artworkService";
import {
  EMPTY_ARTWORK_FORM,
  artworkSchema,
  toArtworkPayload,
  toNewArtwork,
  type ArtworkFormValues,
  type ArtworkPayload,
} from "@/schemas/artwork";

const ArtworkAddPage: React.FC = () => {
  const { collectionId } = useParams<{ collectionId: string }>();
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const form = useForm<ArtworkFormValues, ArtworkPayload>({
    mode: "uncontrolled",
    initialValues: EMPTY_ARTWORK_FORM,
    validateInputOnBlur: true,
    // zod's standard-schema validate is synchronous, so `sync: true` keeps
    // form.validate() synchronous instead of resolving a promise per check.
    validate: schemaResolver(artworkSchema, { sync: true }),
    // The schema's output *is* the payload, so there is no second conversion
    // step: what reaches onSubmit is already trimmed, coerced and stripped of
    // blank fields.
    transformValues: toArtworkPayload,
  });

  // File uploads are not part of the payload yet (FULLSPEC §8), so these stay
  // out of the form.
  const [certificates, setCertificates] = useState<File[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Container size="sm" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Text size="h2" mb="xl">
        Add New Artwork
      </Text>

      <Card shadow="sm" p="lg">
        <form
          // Uncontrolled mode repaints a field by remounting it, which is what
          // form.key is for. It is a function of the field path, not a value.
          onSubmit={form.onSubmit(async (payload) => {
            // Not field validation, so these guards stay out of the schema.
            if (!collectionId) {
              setError("Invalid collection id");
              return;
            }

            if (!currentUser) {
              setError("You must be signed in to add an artwork");
              return;
            }

            setError(null);

            try {
              const newId = await artworkService.createArtwork(
                toNewArtwork(payload, collectionId, currentUser.uid),
              );
              void navigate(
                `/manage/collection/${collectionId}/artwork/${newId}`,
              );
            } catch (err) {
              console.error("Error creating artwork:", err);
              setError("Failed to create artwork. Please try again.");
            }
          })}
        >
          <TextInput
            key={form.key("title")}
            label="Title"
            placeholder="Artwork title"
            required
            mb="md"
            {...form.getInputProps("title")}
          />

          <TextInput
            key={form.key("serie")}
            label="Serie"
            placeholder="Serie name"
            mb="md"
            {...form.getInputProps("serie")}
          />

          <TextInput
            key={form.key("artistName")}
            label="Artist Name"
            placeholder="Artist's full name"
            required
            mb="md"
            {...form.getInputProps("artistName")}
          />

          <TextInput
            key={form.key("dateOfCreation")}
            label="Date of Creation"
            placeholder="YYYY-MM-DD"
            mb="md"
            {...form.getInputProps("dateOfCreation")}
          />

          <TextInput
            key={form.key("media")}
            label="Media"
            placeholder="e.g. Oil on canvas, Bronze, Mixed media"
            mb="md"
            {...form.getInputProps("media")}
          />

          <TextInput
            key={form.key("dimensions")}
            label="Dimensions"
            placeholder="e.g. 100x80 cm"
            mb="md"
            {...form.getInputProps("dimensions")}
          />

          <TextInput
            key={form.key("editions")}
            label="Editions"
            placeholder="e.g. 3/10, Open edition"
            mb="md"
            {...form.getInputProps("editions")}
          />

          <DateInput
            key={form.key("acquisitionDate")}
            label="Acquisition Date"
            placeholder="Select date"
            mb="md"
            {...form.getInputProps("acquisitionDate")}
          />

          <NumberInput
            key={form.key("acquisitionPrice")}
            label="Acquisition Price"
            placeholder="Price in currency"
            mb="md"
            {...form.getInputProps("acquisitionPrice")}
          />

          <TextInput
            key={form.key("placeOfOrigin")}
            label="Place of Origin"
            placeholder="City, Country"
            mb="md"
            {...form.getInputProps("placeOfOrigin")}
          />

          <TextInput
            key={form.key("provenance")}
            label="Provenance"
            placeholder="Where acquired, e.g. Gallery, Auction, Private collection"
            mb="md"
            {...form.getInputProps("provenance")}
          />

          <Textarea
            key={form.key("notes")}
            label="Notes"
            placeholder="Additional information about the artwork"
            mb="md"
            {...form.getInputProps("notes")}
          />

          <TextInput
            key={form.key("condition")}
            label="Condition"
            placeholder="Excellent, Good, Fair, etc."
            mb="md"
            {...form.getInputProps("condition")}
          />

          <NumberInput
            key={form.key("currentValue")}
            label="Current Value"
            placeholder="Value in currency"
            mb="md"
            {...form.getInputProps("currentValue")}
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
            <Button type="submit" loading={form.submitting}>
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
