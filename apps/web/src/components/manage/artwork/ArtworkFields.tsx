/**
 * The field body both artwork forms render: the grid of inputs, the status
 * control, the Availability control and the two uploaders.
 *
 * The two pages differ in what they do with the values, not in what they
 * collect, and this block used to be written out in both of them — kept in step
 * by hand, and already a blank line apart. The pages still own the form, the
 * hooks and the save; this owns the fields.
 */
import React from "react";
import {
  Autocomplete,
  Box,
  Grid,
  SegmentedControl,
  Select,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import type { UseFormReturnType } from "@mantine/form";
import PhotoUploader from "./PhotoUploader";
import DocumentsUploader from "./DocumentsUploader";
import type { UseArtistNames } from "@/hooks/useArtistNames";
import type { UseArtworkPhotos } from "@/hooks/useArtworkPhotos";
import type { UseArtworkDocuments } from "@/hooks/useArtworkDocuments";
import {
  ARTWORK_AVAILABILITY_LABELS,
  ARTWORK_AVAILABILITY_STATES,
} from "@/catalogueSurface";
import type {
  ArtworkFieldStates,
  ArtworkFormValues,
  ArtworkPayload,
} from "@arcula/shared";

/** The four states, as the Select's options. One list for every Kind — whether
 *  the control is on screen is the Catalogue's decision, not the Kind's. */
const availabilityOptions = ARTWORK_AVAILABILITY_STATES.map((value) => ({
  value,
  label: ARTWORK_AVAILABILITY_LABELS[value],
}));

interface ArtworkFieldsProps {
  /** The page's own form instance — the fields read and write through it. */
  form: UseFormReturnType<ArtworkFormValues, ArtworkPayload>;
  photos: UseArtworkPhotos;
  documents: UseArtworkDocuments;
  /** The caller's Artist Name suggestions, fetched once by the page. */
  artistNames: UseArtistNames;
  /**
   * The record fields this catalogue records, resolved from its Kind and its
   * stored deviations. Title and Artist name are always rendered; every other
   * field — Availability included — appears only when its key is enabled, and
   * the page's save omits the disabled keys entirely: a hidden value is kept,
   * never cleared.
   */
  enabledFields: ArtworkFieldStates;
  /**
   * Hide the two uploaders. The Edit page sets this while the work is deleted:
   * staging is a server write, and media staged for a work whose Save is shut
   * could never be attached to it — the same misleading-edit problem the
   * banner exists to prevent. The typed fields stay editable because they are
   * local and survive the in-place restore.
   */
  uploadsDisabled?: boolean;
}

const ArtworkFields: React.FC<ArtworkFieldsProps> = ({
  form,
  photos,
  documents,
  artistNames,
  enabledFields,
  uploadsDisabled = false,
}) => (
  <Grid gap="xl">
    <Grid.Col span={{ base: 12, sm: 8 }}>
      <TextInput
        key={form.key("title")}
        label="Title"
        placeholder="Artwork title"
        required
        mb="md"
        {...form.getInputProps("title")}
      />

      {/*
        Autocomplete, not Select: a name that has never been recorded must
        still save exactly as typed. It stays uncontrolled like every field
        here (`getInputProps` + `key`), so choosing an option only fills this
        field and the value is the same string the TextInput carried.
      */}
      <Autocomplete
        key={form.key("artistName")}
        label="Artist name"
        placeholder="Artist's full name"
        required
        mb="md"
        data={artistNames.names}
        limit={20}
        loading={artistNames.loading}
        {...form.getInputProps("artistName")}
      />

      {enabledFields.serie ? (
        <TextInput
          key={form.key("serie")}
          label="Serie"
          placeholder="Serie name"
          mb="md"
          {...form.getInputProps("serie")}
        />
      ) : null}

      {enabledFields.medium ? (
        <TextInput
          key={form.key("medium")}
          label="Medium"
          placeholder="e.g. Oil on canvas, Bronze, Mixed media"
          mb="md"
          {...form.getInputProps("medium")}
        />
      ) : null}

      {enabledFields.dimensions ? (
        <TextInput
          key={form.key("dimensions")}
          label="Dimensions"
          placeholder="e.g. 100x80 cm"
          mb="md"
          {...form.getInputProps("dimensions")}
        />
      ) : null}

      {enabledFields.editions ? (
        <TextInput
          key={form.key("editions")}
          label="Editions"
          placeholder="e.g. 3/10, Open edition"
          mb="md"
          {...form.getInputProps("editions")}
        />
      ) : null}

      {enabledFields.dateOfCreation ? (
        <TextInput
          key={form.key("dateOfCreation")}
          label="Date of creation"
          placeholder="YYYY-MM-DD"
          mb="md"
          {...form.getInputProps("dateOfCreation")}
        />
      ) : null}

      {enabledFields.acquisitionDate ? (
        <DateInput
          key={form.key("acquisitionDate")}
          label="Acquisition date"
          placeholder="Select date"
          mb="md"
          clearable
          {...form.getInputProps("acquisitionDate")}
        />
      ) : null}

      {enabledFields.acquisitionPrice ? (
        <TextInput
          key={form.key("acquisitionPrice")}
          label="Acquisition price"
          placeholder="Price in currency"
          mb="md"
          {...form.getInputProps("acquisitionPrice")}
        />
      ) : null}

      {enabledFields.placeOfOrigin ? (
        <TextInput
          key={form.key("placeOfOrigin")}
          label="Place of origin"
          placeholder="City, Country"
          mb="md"
          {...form.getInputProps("placeOfOrigin")}
        />
      ) : null}

      {enabledFields.provenance ? (
        <TextInput
          key={form.key("provenance")}
          label="Provenance"
          placeholder="Where acquired, e.g. Gallery, Auction, Private collection"
          mb="md"
          {...form.getInputProps("provenance")}
        />
      ) : null}

      {enabledFields.notes ? (
        <Textarea
          key={form.key("notes")}
          label="Notes"
          placeholder="Additional information about the artwork"
          mb="md"
          autosize
          minRows={4}
          {...form.getInputProps("notes")}
        />
      ) : null}

      {enabledFields.condition ? (
        <TextInput
          key={form.key("condition")}
          label="Condition"
          placeholder="Excellent, Good, Fair, etc."
          mb="md"
          {...form.getInputProps("condition")}
        />
      ) : null}

      {enabledFields.currentValue ? (
        <TextInput
          key={form.key("currentValue")}
          label="Current price"
          placeholder="Value in currency"
          mb="md"
          {...form.getInputProps("currentValue")}
        />
      ) : null}
    </Grid.Col>
    <Grid.Col span={{ base: 12, sm: 4 }}>
      <Text size="sm" fw={500} mb={4}>
        Status
      </Text>
      {/*
        `getInputProps` without a `type`: SegmentedControl takes a string value
        and calls `onChange(value)` with the chosen segment, so the plain input
        props are the shape it wants. In the form's uncontrolled mode that is
        `defaultValue` plus `form.key`, which is how this block's every field
        gets a value loaded into it — here the Edit page's stored status. (The
        fields are not mounted until that load finishes, so the key is the
        reset() case rather than the load's.)
      */}
      <SegmentedControl
        key={form.key("status")}
        data={[
          { label: "Published", value: "published" },
          { label: "Draft", value: "draft" },
        ]}
        fullWidth
        {...form.getInputProps("status")}
      />
      <Text size="sm" c="dimmed" mt={6} mb="md">
        Published if the catalogue is public. A draft stays in the catalogue and
        is visible only to you.
      </Text>

      {enabledFields.availability ? (
        <>
          <Select
            key={form.key("availability")}
            label="Availability"
            data={availabilityOptions}
            allowDeselect={false}
            mb={6}
            {...form.getInputProps("availability")}
          />
          <Text size="sm" c="dimmed" mb="md">
            A member-facing market state. It never changes what a visitor sees.
          </Text>
        </>
      ) : null}

      <Box mb="md">
        <Text size="sm" fw={500} mb={4}>
          Photos
        </Text>
        {uploadsDisabled ? (
          <Text size="sm" c="dimmed">
            Photos are locked while this artwork is deleted. Restore it to
            change them.
          </Text>
        ) : (
          <PhotoUploader photos={photos} />
        )}
      </Box>

      <Box mb="md">
        <Text size="sm" fw={500} mb={4}>
          Other documents
        </Text>
        {uploadsDisabled ? (
          <Text size="sm" c="dimmed">
            Documents are locked while this artwork is deleted. Restore it to
            change them.
          </Text>
        ) : (
          <DocumentsUploader
            documents={documents}
            description="Condition reports, receipts, provenance notes. Only you can see these."
          />
        )}
      </Box>
    </Grid.Col>
  </Grid>
);

export default ArtworkFields;
