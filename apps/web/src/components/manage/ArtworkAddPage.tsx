import React, { useState } from "react";
import {
  Box,
  Text,
  TextInput,
  Textarea,
  Grid,
  Alert,
  Switch,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { schemaResolver } from "@mantine/form";
import { useParams, useNavigate } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import { useAuth } from "@/hooks/useAuth";
import { useArtworkPhotos } from "@/hooks/useArtworkPhotos";
import { useArtworkDocuments } from "@/hooks/useArtworkDocuments";
import { artworkService } from "@/services/artworkService";
import { imageService } from "@/services/imageService";
import { documentService } from "@/services/documentService";
import PhotoUploader from "@/components/manage/artwork/PhotoUploader";
import DocumentsUploader from "@/components/manage/artwork/DocumentsUploader";
import FormActionsBar, {
  BAR_HEIGHT,
} from "@/components/manage/artwork/FormActionsBar";

import {
  EMPTY_ARTWORK_FORM,
  artworkSchema,
  toArtworkPayload,
  toNewArtwork,
  type ArtworkFormValues,
  type ArtworkPayload,
} from "@/schemas/artwork";
import { artworkSlug, parseId } from "@/utils/slug";

/**
 * Where the Add page sends the user: the Edit page for the artwork it just
 * created, carrying `warn` when a later upload stage failed.
 *
 * The param is a query rather than state because the Edit page can be reached
 * cold — a refresh, or the URL pasted into a new tab — and a message about a
 * failed upload has to still be there. `stage` is omitted on the success path so
 * the URL stays clean; the Edit page strips the param once it has shown it, so
 * a later refresh does not re-raise a warning about an upload already fixed.
 */
const ArtworkAddPage: React.FC = () => {
  const { collectionId: param } = useParams<{ collectionId: string }>();
  // The route carries "{slug}-{id}"; the artwork must store the bare id, or the
  // dashboard — which looks collections up by id — would not find it.
  const collectionId = parseId(param ?? "");
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  /**
   * Where this page sends the user: the Edit page for the artwork it just
   * created, carrying `warn` when a later upload stage failed.
   *
   * A query param rather than in-memory state because the Edit page can be
   * reached cold — a refresh, or the URL pasted into a new tab — and a message
   * about a failed upload has to still be there. `stage` is omitted on the
   * success path so the URL stays clean, and the Edit page strips the param
   * once shown, so a later refresh does not re-raise a warning about an upload
   * that is already fixed.
   *
   * `param` is the raw route segment rather than the parsed id, because the
   * Edit route re-parses it itself and the manage pages have always passed the
   * slugged form straight through.
   */
  const editPath = (
    title: string,
    artworkId: string,
    stage?: "photos" | "documents",
  ): string => {
    const base = `/manage/collection/${param ?? ""}/artwork/${artworkSlug(
      title,
      artworkId,
    )}`;
    return stage ? `${base}?warn=${stage}` : base;
  };

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
  const [documentError, setDocumentError] = useState<string | null>(null);
  // Photos and documents live outside the form entirely — see useArtworkPhotos
  // for why a File cannot survive `useForm` in uncontrolled mode.
  const photos = useArtworkPhotos({ onError: setPhotoError });
  const documents = useArtworkDocuments({ onError: setDocumentError });

  return (
    <>
      <Text size="h2" mb="xl">
        Add New Artwork
      </Text>

      <form
        // Room for the fixed action bar. Without it the bar sits permanently on
        // top of `currentValue` and the error alerts, which is exactly the
        // content a user most needs to read after a failure.
        style={{ paddingBottom: BAR_HEIGHT + 24 }}
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

          // Which write was in flight when something threw.
          //
          // Not inferable from the pending lists: those still hold their files
          // after a successful upload, so "photos.pendingImages is non-empty"
          // cannot tell you the photos were the thing that failed. It says only
          // that some were queued, which is true of the artwork even when every
          // one of them uploaded fine and the *documents* are what broke.
          let stage: "create" | "photos" | "documents" = "create";
          // Hoisted so the catch can build the redirect. `stage !== "create"`
          // is exactly the guarantee that this is populated: the only way past
          // the create write is to have completed it.
          let createdId = "";
          // The payload as written, which is the only statement of the new
          // artwork's title that cannot disagree with Firestore. Hoisted with
          // `createdId` because the catch names the artwork it redirected to.
          let title = "";

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
            title = artwork.title;
            createdId = await artworkService.createArtwork(artwork);

            if (photos.pendingImages.length > 0) {
              stage = "photos";
              const uploaded = await imageService.uploadArtworkPhotos({
                userId: currentUser.uid,
                collectionId,
                artworkId: createdId,
                // Already generated when the files were added, so the save is
                // uploads only.
                photos: photos.pendingImages,
              });
              await artworkService.updateArtwork(createdId, {
                photos: photos.mergeUploaded(uploaded),
              });
            }

            // A second update rather than one merged with the photos above, on
            // purpose. If documents were written in the same call, a document
            // failure would land after the photos were already recorded and
            // report the whole save as failed — or, if swallowed to avoid that,
            // leave the photo references unrecorded and the objects orphaned.
            // Two independent updates means each field is either right or
            // untouched, and the message below can say which went wrong.
            if (documents.pendingUploads.length > 0) {
              stage = "documents";
              const uploaded = await documentService.uploadArtworkDocuments({
                userId: currentUser.uid,
                collectionId,
                artworkId: createdId,
                documents: documents.pendingUploads,
              });
              await artworkService.updateArtwork(createdId, {
                documents: documents.mergeUploaded(uploaded),
              });
            }

            // One exit for every outcome. A partial failure lands here too and
            // carries the reason in `warn`; the Edit page renders it. Holding
            // the form open instead would mean the message told the user to
            // "open it to try again" while the artwork is already saved and
            // the only route to fixing it is the dashboard.
            notifications.show({
              title: "Artwork created",
              message: `"${title}" was added to this collection.`,
            });
            void navigate(editPath(title, createdId));
          } catch (err) {
            console.error("Error creating artwork:", err);
            // The artwork exists by the time either upload can fail, so the
            // outcome has to distinguish "nothing was saved" from "saved, minus
            // some files" — the second is recoverable from the Edit form, and
            // saying "failed" would send the user looking for a missing record.
            //
            // Keyed on the stage rather than on the pending lists, so a document
            // failure after the photos landed does not tell the user their
            // images are missing.
            if (stage === "create") {
              // Nothing was written, so the form still holds everything the user
              // typed. Staying on it is the whole point of this branch.
              setError("Failed to create artwork. Please try again.");
              return;
            }
            // Past this point the document is written, so this form can no
            // longer fix it. Redirect *and* say what went wrong: the message has
            // to survive the navigation, which is what `warn` is for.
            notifications.show({
              title: "Artwork created",
              color: "yellow",
              message:
                stage === "photos"
                  ? "The artwork was created, but its images could not be uploaded."
                  : "The artwork was created, but its documents could not be uploaded.",
            });
            void navigate(editPath(title, createdId, stage));
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

        {photoError ? (
          <Alert color="red" mb="md">
            {photoError}
          </Alert>
        ) : null}

        {documentError ? (
          <Alert color="red" mb="md">
            {documentError}
          </Alert>
        ) : null}

        {/*
          Inside the form, so Save is a real submit control: keyboard
          submission, form validation and the `loading` state all work as they
          did when the buttons were an inline Group.
        */}
        <FormActionsBar
          submitLabel="Save Artwork"
          submitting={form.submitting}
          cancelTo={`/manage/collection/${param ?? ""}`}
        />
      </form>
    </>
  );
};

export default ArtworkAddPage;
