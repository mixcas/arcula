import React, { useEffect, useState } from "react";
import {
  Box,
  Text,
  TextInput,
  Textarea,
  Grid,
  Alert,
  Loader,
  Switch,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useForm, schemaResolver } from "@mantine/form";
import { useNavigate, useParams } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import { useArtworkPhotos } from "@/hooks/useArtworkPhotos";
import { useArtworkDocuments } from "@/hooks/useArtworkDocuments";
import { artworkService } from "@/services/artworkService";
import { ApiRequestError } from "@/services/api";
import PhotoUploader from "@/components/manage/artwork/PhotoUploader";
import DocumentsUploader from "@/components/manage/artwork/DocumentsUploader";
import FormActionsBar, {
  BAR_HEIGHT,
} from "@/components/manage/artwork/FormActionsBar";

import {
  EMPTY_ARTWORK_FORM,
  artworkSchema,
  fromArtwork,
  toArtworkPayload,
  type ArtworkFormValues,
  type ArtworkPayload,
} from "@arcula/shared";
import { toArtworkUpdate } from "@/schemas/artwork";
import { artworkSlug, parseId } from "@arcula/shared";

/**
 * The Edit save is one PATCH. The text fields come from `toArtworkUpdate`,
 * which decides per field between "set", "clear" (`null`) and "leave alone"
 * (absent) against the loaded values; the photo and document sequences are
 * attached only when their `commit()` says they changed — an absent key
 * leaves the stored sequence alone, which is what keeps a title-only save
 * from renumbering fifty rows.
 */
const ArtworkEditPage: React.FC = () => {
  const { collectionId: collectionParam, artworkId: artworkParam } = useParams<{
    collectionId: string;
    artworkId: string;
  }>();
  // Either segment may be a bare id or a "{slug}-{id}" param; the API needs the
  // bare ids.
  const collectionId = parseId(collectionParam ?? "");
  const artworkId = parseId(artworkParam ?? "");
  const navigate = useNavigate();

  const form = useForm<ArtworkFormValues, ArtworkPayload>({
    mode: "uncontrolled",
    initialValues: EMPTY_ARTWORK_FORM,
    validateInputOnBlur: true,
    validate: schemaResolver(artworkSchema, { sync: true }),
    transformValues: toArtworkPayload,
  });
  // Destructured so the effect depends on the stable callback rather than on
  // the `form` object, which is rebuilt every render.
  const { initialize } = form;

  // Values as loaded from the API. Needed at save time to tell a field the
  // user cleared apart from one that was never set — see toArtworkUpdate.
  // State rather than a ref: the submit handler is built during render, and
  // react-hooks/refs rejects reading a ref there.
  const [loadedValues, setLoadedValues] =
    useState<ArtworkFormValues>(EMPTY_ARTWORK_FORM);

  // The title as loaded, kept apart from the form's own `title` field — that is
  // the editable buffer, and rewriting the URL from it would fire on every
  // keystroke. Null until the fetch succeeds, which is also what stops an
  // artwork that failed to load from being rewritten to a guessed slug.
  const [loadedTitle, setLoadedTitle] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  // Kept separate from `error`: a load failure means there is nothing to edit,
  // but a save failure must leave the user's input on screen.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The hooks stage under the collection and artwork the route names — no load
  // has to complete first, because staging needs neither.
  const photos = useArtworkPhotos({ collectionId, artworkId });
  const documents = useArtworkDocuments({ collectionId, artworkId });
  // Destructured for the same reason as `initialize` above: the load effect must
  // depend on the stable callback, not on a hook result object rebuilt each
  // render.
  const { hydrate: photosHydrate } = photos;
  const { hydrate: documentsHydrate } = documents;

  useEffect(() => {
    if (!collectionId || !artworkId) {
      // The render below shows the invalid-id alert before any of this state,
      // so the guard has nothing to set — only the fetch to skip.
      return;
    }

    const fetchArtwork = async () => {
      try {
        const artwork = await artworkService.getArtwork(
          collectionId,
          artworkId,
        );
        if (!artwork) {
          setLoadError("Artwork not found");
          return;
        }

        const values = fromArtwork(artwork);
        setLoadedValues(values);
        setLoadedTitle(values.title);
        // The stored photos, hydrated into the working list. This is what makes
        // an existing image re-orderable and removable rather than only
        // appendable.
        photosHydrate(artwork.photos);
        // The same for documents, so an existing one is removable rather than
        // only appendable.
        documentsHydrate(artwork.documents);
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
  }, [collectionId, artworkId, initialize, photosHydrate, documentsHydrate]);

  // Put the canonical "{title}-{id}" in the address bar once the title is
  // known, preserving the collection segment exactly as it arrived — this page
  // never loads the collection, so it has no name to re-slug it from.
  // `replace` swaps the current history entry rather than adding one.
  useEffect(() => {
    if (!artworkParam || loadedTitle === null) {
      return;
    }
    const canonical = artworkSlug(loadedTitle, artworkId);
    if (canonical === artworkParam) {
      return;
    }
    void navigate(
      `/manage/collection/${collectionParam}/artwork/${canonical}`,
      {
        replace: true,
      },
    );
  }, [artworkParam, collectionParam, artworkId, loadedTitle, navigate]);

  if (!artworkId || !collectionId) {
    return <Alert color="red">Invalid artwork id</Alert>;
  }

  if (loading) {
    return <Loader />;
  }

  if (loadError) {
    return <Alert color="red">{loadError}</Alert>;
  }

  return (
    <>
      <Text size="h2" mb="xl">
        Edit Artwork
      </Text>
      <form
        // Room for the fixed action bar, so the last field and the alerts
        // above are never permanently behind it.
        style={{ paddingBottom: BAR_HEIGHT + 24 }}
        // Uncontrolled mode repaints a field by remounting it, which is what
        // form.key is for. It is a function of the field path, not a value.
        onSubmit={form.onSubmit(async (payload) => {
          setError(null);

          try {
            // One PATCH, one transaction on the server: the fields, and the
            // full new sequences whenever they differ from what was loaded.
            const photosCommit = photos.commit();
            const documentsCommit = documents.commit();
            await artworkService.updateArtwork(collectionId, artworkId, {
              ...toArtworkUpdate(loadedValues, payload),
              ...(photosCommit ? { photos: photosCommit } : {}),
              ...(documentsCommit ? { documents: documentsCommit } : {}),
            });
            // No redirect. This form is where a second pass over a long field
            // list is done — leaving would throw away the scroll position on
            // every save. A toast is enough confirmation: the timestamps and
            // the unchanged inputs are both proof it worked.
            notifications.show({
              title: "Artwork saved",
              message: `"${payload.title}" was updated.`,
            });
          } catch (err) {
            console.error("Error updating artwork:", err);
            // A cap hit carries the server's own message ("at most N …"),
            // which is the one to show; everything else stays generic so the
            // alert does not leak a status line.
            setError(
              err instanceof ApiRequestError &&
                err.status === 409 &&
                err.code === "limit-reached"
                ? err.message
                : "Failed to save artwork. Please try again.",
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
            <Box mb="md">
              <Text size="sm" fw={500} mb={4}>
                Other Documents
              </Text>
              <DocumentsUploader
                documents={documents}
                description="Condition reports, receipts, provenance notes. Only you can see these."
              />
            </Box>
          </Grid.Col>
        </Grid>

        {error ? (
          <Alert color="red" mb="md">
            {error}
          </Alert>
        ) : null}

        {/*
          Inside the form, so Save is still a real submit control and keeps
          keyboard submission, validation and the `loading` state.
        */}
        <FormActionsBar
          submitLabel="Save Changes"
          submitting={form.submitting}
          cancelTo={`/manage/collection/${collectionParam ?? ""}`}
        />
      </form>
    </>
  );
};

export default ArtworkEditPage;
