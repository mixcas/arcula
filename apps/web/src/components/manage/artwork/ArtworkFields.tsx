/**
 * The field body both artwork forms render: the grid of inputs, the public
 * switch, and the two uploaders.
 *
 * The two pages differ in what they do with the values, not in what they
 * collect, and this block used to be written out in both of them — kept in step
 * by hand, and already a blank line apart. The pages still own the form, the
 * hooks and the save; this owns the fields.
 */
import React from "react";
import { Box, Grid, Switch, Text, Textarea, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import type { UseFormReturnType } from "@mantine/form";
import PhotoUploader from "./PhotoUploader";
import DocumentsUploader from "./DocumentsUploader";
import type { UseArtworkPhotos } from "@/hooks/useArtworkPhotos";
import type { UseArtworkDocuments } from "@/hooks/useArtworkDocuments";
import type { ArtworkFormValues, ArtworkPayload } from "@arcula/shared";

interface ArtworkFieldsProps {
  /** The page's own form instance — the fields read and write through it. */
  form: UseFormReturnType<ArtworkFormValues, ArtworkPayload>;
  photos: UseArtworkPhotos;
  documents: UseArtworkDocuments;
}

const ArtworkFields: React.FC<ArtworkFieldsProps> = ({
  form,
  photos,
  documents,
}) => (
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
);

export default ArtworkFields;
