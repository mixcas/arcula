import React, { useState } from "react";
import {
  Box,
  Text,
  TextInput,
  Textarea,
  Button,
  Grid,
  Group,
  FileInput,
  Alert,
  Switch,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { schemaResolver } from "@mantine/form";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useArtworkPhotos } from "@/hooks/useArtworkPhotos";
import { artworkService } from "@/services/artworkService";
import { imageService } from "@/services/imageService";
import PhotoUploader from "@/components/manage/artwork/PhotoUploader";

import {
  EMPTY_ARTWORK_FORM,
  artworkSchema,
  toArtworkPayload,
  toNewArtwork,
  type ArtworkFormValues,
  type ArtworkPayload,
} from "@/schemas/artwork";
import { artworkSlug, parseId } from "@/utils/slug";

const ArtworkAddPage: React.FC = () => {
  const { collectionId: param } = useParams<{ collectionId: string }>();
  // The route carries "{slug}-{id}"; the artwork must store the bare id, or the
  // dashboard — which looks collections up by id — would not find it.
  const collectionId = parseId(param ?? "");
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

  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Photos live outside the form entirely — see useArtworkPhotos for why a
  // File cannot survive `useForm` in uncontrolled mode. Certificates are still
  // unwired (FULLSPEC §8) and keep their placeholder input.
  const photos = useArtworkPhotos({ onError: setPhotoError });
  const [certificates, setCertificates] = useState<File[]>([]);

  return (
    <>
      <Text size="h2" mb="xl">
        Add New Artwork
      </Text>

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
            // Two writes, not one. The document has to exist before Storage
            // has an id to put objects under, and the id cannot be known
            // before the document exists — so the artwork is created with an
            // empty photo list and the photos are attached immediately after.
            // A failure between the two leaves a valid artwork with no photos,
            // which the Edit form can fix; the reverse order would leave
            // orphaned objects in Storage.
            const artwork = toNewArtwork(
              payload,
              collectionId,
              currentUser.uid,
            );
            const newId = await artworkService.createArtwork(artwork);

            if (photos.pendingImages.length > 0) {
              const uploaded = await imageService.uploadArtworkPhotos({
                userId: currentUser.uid,
                collectionId,
                artworkId: newId,
                // Already generated when the files were added, so the save is
                // uploads only.
                photos: photos.pendingImages,
              });
              await artworkService.updateArtwork(newId, {
                photos: photos.mergeUploaded(uploaded),
              });
            }

            // Slugged from the document that was just written rather than
            // from the form, so the URL can never disagree with Firestore.
            void navigate(
              `/manage/collection/${param}/artwork/${artworkSlug(artwork.title, newId)}`,
            );
          } catch (err) {
            console.error("Error creating artwork:", err);
            setError(
              photos.pendingImages.length > 0
                ? "The artwork was saved, but its images could not be uploaded. Open it to try again."
                : "Failed to create artwork. Please try again.",
            );
          }
        })}
      >
        <Grid gap="xl">
          <Grid.Col span={8}>
            <TextInput
              key={form.key("title")}
              label="Title"
              placeholder="Artwork title"
              required
              mb="md"
              {...form.getInputProps("title")}
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
              key={form.key("serie")}
              label="Serie"
              placeholder="Serie name"
              mb="md"
              {...form.getInputProps("serie")}
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

            <TextInput
              key={form.key("dateOfCreation")}
              label="Date of Creation"
              placeholder="YYYY-MM-DD"
              mb="md"
              {...form.getInputProps("dateOfCreation")}
            />

            <DateInput
              key={form.key("acquisitionDate")}
              label="Acquisition Date"
              placeholder="Select date"
              mb="md"
              clearable
              {...form.getInputProps("acquisitionDate")}
            />

            <TextInput
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

            <TextInput
              key={form.key("currentValue")}
              label="Current Value"
              placeholder="Value in currency"
              mb="md"
              {...form.getInputProps("currentValue")}
            />
          </Grid.Col>
          <Grid.Col span={4}>
            <Switch
              key={form.key("isPublic")}
              label="Public"
              description="On by default — anyone with the collection link can see this artwork. Independent of the collection's own public setting: a public collection may keep individual works private."
              mb="md"
              {...form.getInputProps("isPublic", { type: "checkbox" })}
            />

            <Box mb="md">
              <Text size="sm" fw={500} mb={4}>
                Photos
              </Text>
              <PhotoUploader photos={photos} />
            </Box>

            <FileInput
              label="Certificates"
              placeholder="Upload PDF, JPG, PNG files"
              multiple
              accept="application/pdf,image/jpeg,image/png"
              value={certificates}
              onChange={(files) => setCertificates(files ?? [])}
              disabled
              description="File uploads are not wired up yet"
              mb="md"
            />
          </Grid.Col>
        </Grid>

        {error ? (
          <Alert color="red" mb="md">
            {error}
          </Alert>
        ) : null}

        {photoError ? (
          <Alert color="red" mb="md">
            {photoError}
          </Alert>
        ) : null}

        <Group mt="xl">
          <Button type="submit" loading={form.submitting}>
            Save Artwork
          </Button>
          <Button
            component={Link}
            to={`/manage/collection/${param}`}
            variant="outline"
          >
            Cancel
          </Button>
        </Group>
      </form>
    </>
  );
};

export default ArtworkAddPage;
