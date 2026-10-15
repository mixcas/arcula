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
  toArtworkPayload,
  toArtworkCreatePayload,
  type ArtworkFormValues,
  type ArtworkPayload,
} from "@arcula/shared";
import { artworkSlug, parseId } from "@arcula/shared";

/**
 * The Add page is a single write: the form fields, the client-minted artwork
 * id, and the staged photo/document entries go up in one POST, and the API
 * promotes the staged objects into rows in the same transaction as the
 * fields. There is no partial save: the transaction either lands or it does
 * not.
 */
const ArtworkAddPage: React.FC = () => {
  const { collectionId: param } = useParams<{ collectionId: string }>();
  // The route carries "{slug}-{id}"; the API needs the bare id.
  const collectionId = parseId(param ?? "");
  const navigate = useNavigate();

  // The artwork id, minted here. The staged entries are PUT under it while the
  // form is open, and the save creates the row with it — one id, decided once,
  // so staging and the row can never name different artworks.
  //
  // Hyphen-free on purpose: the edit link this save lands on is
  // `{title}-{id}`, and the route recovers the id by cutting at the LAST
  // hyphen. A hyphenated id would put that cut inside the id, and the page
  // would arrive at its own work under the wrong name. The API mints its own
  // ids the same way, so both halves of the segment obey one rule.
  const [artworkId] = useState(() => crypto.randomUUID().replace(/-/g, ""));

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
  // Photos and documents live outside the form entirely — see useArtworkPhotos
  // for why a File cannot survive `useForm` in uncontrolled mode. Staging
  // happens at add time, under the collection the route names.
  const photos = useArtworkPhotos({ collectionId, artworkId });
  const documents = useArtworkDocuments({ collectionId, artworkId });

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
          // Not field validation, so this guard stays out of the schema.
          if (!collectionId) {
            setError("Invalid collection id");
            return;
          }

          setError(null);

          try {
            // One write: the fields plus the staged entries, promoted in the
            // same transaction. `commit()` answers null when the list is
            // unchanged, which on a new artwork means "nothing staged".
            const body = toArtworkCreatePayload(
              payload,
              artworkId,
              photos.commit() ?? [],
              documents.commit() ?? [],
            );
            const created = await artworkService.createArtwork(
              collectionId,
              body,
            );
            notifications.show({
              title: "Artwork created",
              message: `"${created.title}" was added to this collection.`,
            });
            void navigate(
              `/manage/collection/${param ?? ""}/artwork/${artworkSlug(
                created.title,
                created.id,
              )}`,
            );
          } catch (err) {
            console.error("Error creating artwork:", err);
            // A cap hit carries the server's own message ("at most N …"),
            // which is the one to show; everything else stays generic so the
            // alert does not leak a status line.
            setError(
              err instanceof ApiRequestError &&
                err.status === 409 &&
                err.code === "limit-reached"
                ? err.message
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
