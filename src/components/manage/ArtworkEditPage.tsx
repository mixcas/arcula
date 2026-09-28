import React, { useEffect, useState } from "react";
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
  Loader,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useForm, schemaResolver } from "@mantine/form";
import { Link, useParams, useNavigate } from "react-router-dom";
import { artworkService } from "@/services/artworkService";
import {
  EMPTY_ARTWORK_FORM,
  artworkSchema,
  fromArtwork,
  toArtworkPayload,
  toArtworkUpdate,
  type ArtworkFormValues,
  type ArtworkPayload,
} from "@/schemas/artwork";

const ArtworkEditPage: React.FC = () => {
  const { collectionId, artworkId } = useParams<{
    collectionId: string;
    artworkId: string;
  }>();
  const navigate = useNavigate();

  const form = useForm<ArtworkFormValues, ArtworkPayload>({
    mode: "uncontrolled",
    initialValues: EMPTY_ARTWORK_FORM,
    validateInputOnBlur: true,
    validate: schemaResolver(artworkSchema, { sync: true }),
    transformValues: toArtworkPayload,
  });
  // Destured so the effect depends on the stable callback rather than on the
  // `form` object, which is rebuilt every render.
  const { initialize } = form;

  // Values as loaded from Firestore. Needed at save time to tell a field the
  // user cleared apart from one that was never set — see toArtworkUpdate.
  // State rather than a ref: the submit handler is built during render, and
  // react-hooks/refs rejects reading a ref there.
  const [loadedValues, setLoadedValues] =
    useState<ArtworkFormValues>(EMPTY_ARTWORK_FORM);

  const [loading, setLoading] = useState(true);
  // Kept separate from `error`: a load failure means there is nothing to edit,
  // but a save failure must leave the user's input on screen.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // File uploads are not part of the payload yet (FULLSPEC §8), so these stay
  // out of the form.
  const [certificates, setCertificates] = useState<File[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);

  useEffect(() => {
    if (!artworkId) {
      return;
    }

    const fetchArtwork = async () => {
      try {
        const artwork = await artworkService.getArtwork(artworkId);
        if (!artwork) {
          setLoadError("Artwork not found");
          return;
        }

        const values = fromArtwork(artwork);
        setLoadedValues(values);
        // In uncontrolled mode this bumps the form key, which is what remounts
        // the inputs with the loaded values as their new defaults.
        initialize(values);
      } catch (err) {
        console.error("Error fetching artwork:", err);
        setLoadError("Failed to load artwork. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    void fetchArtwork();
  }, [artworkId, initialize]);

  if (!artworkId) {
    return (
      <Container
        size="sm"
        style={{ paddingTop: "2rem", paddingBottom: "2rem" }}
      >
        <Alert color="red">Invalid artwork id</Alert>
      </Container>
    );
  }

  if (loading) {
    return (
      <Container
        size="sm"
        style={{ paddingTop: "2rem", paddingBottom: "2rem" }}
      >
        <Loader />
      </Container>
    );
  }

  if (loadError) {
    return (
      <Container
        size="sm"
        style={{ paddingTop: "2rem", paddingBottom: "2rem" }}
      >
        <Alert color="red">{loadError}</Alert>
      </Container>
    );
  }

  return (
    <Container size="sm" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Text size="h2" mb="xl">
        Edit Artwork
      </Text>

      <Card shadow="sm" p="lg">
        <form
          // Uncontrolled mode repaints a field by remounting it, which is what
          // form.key is for. It is a function of the field path, not a value.
          onSubmit={form.onSubmit(async (payload) => {
            setError(null);

            try {
              await artworkService.updateArtwork(
                artworkId,
                toArtworkUpdate(loadedValues, payload),
              );
              void navigate(`/manage/collection/${collectionId}`);
            } catch (err) {
              console.error("Error updating artwork:", err);
              setError("Failed to save artwork. Please try again.");
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
            onChange={(files) => setCertificates(files ?? [])}
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
            onChange={(files) => setPhotos(files ?? [])}
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
              Save Changes
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

export default ArtworkEditPage;
