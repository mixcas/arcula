/**
 * The settings page's General tab: the catalogue's own facts — name,
 * description, public or private, the password control, and the Artwork fields
 * switches.
 *
 * Its Save writes only this tab's fields: the decision in
 * `catalogueSettingsSave` answers the payload, and the tab is clean — Save
 * disabled — exactly when that payload is empty. A mismatch answers an error
 * and leaves Save offered, so the member can correct it and be told why.
 *
 * The buffers start from the values the page last loaded or saved; leaving
 * the tab unmounts the panel and drops what was typed, which is why a save
 * that took is the only thing that survives a tab round trip.
 */

import React, { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Divider,
  Group,
  PasswordInput,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  ARTWORK_FIELD_DEFAULTS,
  ARTWORK_FIELD_LABELS,
  resolveArtworkFields,
  type ArtworkFieldKey,
  type ArtworkFieldStates,
  type Catalogue,
} from "@arcula/shared";
import { catalogueSurface } from "@/catalogueSurface";
import CatalogueKindBadge from "./CatalogueKindBadge";
import { passwordControlMode } from "./cataloguePassword";
import {
  resolveGeneralSave,
  type GeneralEditedValues,
} from "./catalogueSettingsSave";

/** The two switch groups. Provenance belongs to the work: it describes the
 *  chain of hands, not a market fact. */
const WORK_FIELDS = [
  "serie",
  "dateOfCreation",
  "medium",
  "dimensions",
  "editions",
  "placeOfOrigin",
  "provenance",
  "condition",
  "notes",
] as const satisfies readonly ArtworkFieldKey[];

const MARKET_FIELDS = [
  "availability",
  "acquisitionDate",
  "acquisitionPrice",
  "currentValue",
] as const satisfies readonly ArtworkFieldKey[];

/** The market fields' one-line explanations — the only ones that need words:
 *  the rest are the form's own labels. */
const MARKET_DESCRIPTIONS: Record<(typeof MARKET_FIELDS)[number], string> = {
  availability:
    "Whether a work is available, reserved, sold, or on consignment.",
  acquisitionDate: "When the work entered this catalogue's hands.",
  acquisitionPrice: "What was paid for it, in the catalogue's own currency.",
  currentValue: "What the work is worth now.",
};

// Every registry key is placed in exactly one group: an addition that lands in
// neither is a build error rather than a switch nobody can reach.
type EveryFieldIsGrouped =
  Exclude<
    ArtworkFieldKey,
    (typeof WORK_FIELDS)[number] | (typeof MARKET_FIELDS)[number]
  > extends never
    ? true
    : never;
const everyFieldIsGrouped: EveryFieldIsGrouped = true;
void everyFieldIsGrouped;

interface GeneralTabProps {
  /** The document the page last loaded or saved — the tab's "loaded" side. */
  catalogue: Catalogue;
  saving: boolean;
  /** The page's save: it re-derives the payload and posts it. */
  onSave: (edited: GeneralEditedValues) => void | Promise<void>;
}

const GeneralTab: React.FC<GeneralTabProps> = ({
  catalogue,
  saving,
  onSave,
}) => {
  // The editable buffers, apart from the loaded values for the same reason
  // the old form kept them apart: the save compares against the loaded
  // values, and folding them into one field would make "changed" always true.
  const [name, setName] = useState(catalogue.name);
  const [description, setDescription] = useState(catalogue.description ?? "");
  const [isPublic, setIsPublic] = useState(catalogue.isPublic === true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // The two deliberate states beyond "show the fields": changing a password
  // that is already set, and a removal waiting for Save.
  const [editingPassword, setEditingPassword] = useState(false);
  const [removingPassword, setRemovingPassword] = useState(false);
  // The Artwork fields switches, as every field's state. They start from what
  // the catalogue actually resolves to — its Kind's defaults, adjusted by the
  // stored deviations — and Reset puts them back there.
  const [artworkFields, setArtworkFields] = useState<ArtworkFieldStates>(
    () => resolveArtworkFields(catalogue.kind, catalogue.artworkFields).enabled,
  );

  const edited: GeneralEditedValues = {
    name,
    description,
    isPublic,
    password,
    confirm: confirmPassword,
    editingPassword,
    removingPassword,
    artworkFields,
  };

  // The same answer that becomes the wire body: clean — Save stays off —
  // exactly when it is an empty payload. An error keeps Save offered.
  const decision = resolveGeneralSave(
    {
      name: catalogue.name,
      description: catalogue.description ?? null,
      isPublic: catalogue.isPublic === true,
      isPasswordProtected: catalogue.isPasswordProtected === true,
      kind: catalogue.kind,
      artworkFields: catalogue.artworkFields ?? null,
    },
    edited,
  );
  const clean =
    decision.kind === "payload" && Object.keys(decision.payload).length === 0;

  const passwordMode = passwordControlMode({
    isPublic,
    isPasswordProtected: catalogue.isPasswordProtected === true,
    editing: editingPassword,
    removing: removingPassword,
  });

  // The kind is fixed, so its job here is to name the two fields and to stay
  // visible as its colour-coded badge: after creation this is where a member
  // confirms what the catalogue is.
  const surface = catalogueSurface(catalogue.kind);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(edited);
      }}
    >
      <Card shadow="sm" p="lg">
        <Group mb="md" gap="sm">
          <CatalogueKindBadge kind={catalogue.kind} />
          <Text size="sm" c="dim">
            The kind is fixed at creation.
          </Text>
        </Group>

        <TextInput
          label={surface.nameLabel}
          placeholder={`Enter ${surface.nameLabel.toLowerCase()}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          mb="md"
        />

        <Textarea
          label={surface.descriptionLabel}
          placeholder={`Enter ${surface.descriptionLabel.toLowerCase()}`}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          autosize
          minRows={3}
          maxRows={8}
          mb="md"
        />

        <Divider mt="md" mb="md" />

        <Text size="h3" mb="md">
          Privacy Settings
        </Text>

        <Text size="sm" fw={600}>
          Make Catalogue Public
        </Text>
        <SegmentedControl
          data={[
            { label: "Private", value: "private" },
            { label: "Public", value: "public" },
          ]}
          value={isPublic ? "public" : "private"}
          onChange={(value) => {
            const nextPublic = value === "public";
            setIsPublic(nextPublic);
            if (nextPublic) return;
            // The password control disappears on a private catalogue.
            // Drop any unsaved password intent with it, rather than
            // applying a hidden Remove or a half-typed change on Save.
            setEditingPassword(false);
            setRemovingPassword(false);
            setPassword("");
            setConfirmPassword("");
          }}
          fullWidth
          mb="md"
        />

        {/*
          The password control, in the four states ADR-0005 names. A
          private catalogue shows nothing: there is no visitor in front of
          it to protect the works from. The confirmation is checked here and
          never sent — the payload carries `password` alone.
        */}
        {passwordMode === "protected" && (
          <Box mb="md">
            <Text fw={600}>
              Protected — the current password stays in effect
            </Text>
            <Group mt="xs">
              <Button
                type="button"
                variant="light"
                onClick={() => {
                  setPassword("");
                  setConfirmPassword("");
                  setEditingPassword(true);
                  setRemovingPassword(false);
                }}
              >
                Reset password
              </Button>
              <Button
                type="button"
                variant="subtle"
                color="red"
                onClick={() => {
                  setEditingPassword(false);
                  setRemovingPassword(true);
                }}
              >
                Remove password
              </Button>
            </Group>
          </Box>
        )}

        {passwordMode === "removing" && (
          <Alert color="yellow" mb="md" title="The password will be removed">
            <Text size="sm">
              Anyone with the link will be able to read this catalogue again as
              soon as the change is saved.
            </Text>
            <Button
              type="button"
              variant="subtle"
              mt="xs"
              onClick={() => setRemovingPassword(false)}
            >
              Cancel
            </Button>
          </Alert>
        )}

        {(passwordMode === "fields" || passwordMode === "editing") && (
          <>
            <PasswordInput
              label="Password"
              description="Visitors need this password to read the catalogue."
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              mb="sm"
            />
            <PasswordInput
              label="Confirm password"
              placeholder="Type it again"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.currentTarget.value)}
              mb="sm"
            />
            {passwordMode === "editing" && (
              <Button
                type="button"
                variant="subtle"
                mb="md"
                onClick={() => {
                  setPassword("");
                  setConfirmPassword("");
                  setEditingPassword(false);
                }}
              >
                Cancel
              </Button>
            )}
          </>
        )}
      </Card>

      <Card shadow="sm" p="lg" mt="lg">
        <Text size="h3" mb="xs">
          Artwork fields
        </Text>
        <Text size="sm" c="dimmed" mb="md">
          Choose which fields an Artwork in this catalogue records. Untouched,
          these follow the {surface.kindLabel} defaults.
        </Text>
        <Text size="sm" c="dimmed" mb="sm">
          Title and Artist Name are always recorded.
        </Text>

        {/* The state of the buffer, not of the stored row: the Reset control
            appears the moment a switch leaves the defaults, before the save
            that would persist it. */}
        <Group justify="space-between" align="center" mb="md" gap="sm">
          <Text size="sm" fw={600}>
            {decision.artworkFieldsCustomised
              ? "Customised"
              : `Using the ${surface.kindLabel} defaults`}
          </Text>
          {decision.artworkFieldsCustomised ? (
            <Group gap={4}>
              <Text size="sm" c="dimmed">
                ·
              </Text>
              <Button
                type="button"
                variant="subtle"
                size="compact-sm"
                onClick={() =>
                  setArtworkFields({
                    ...ARTWORK_FIELD_DEFAULTS[catalogue.kind],
                  })
                }
              >
                Reset to defaults
              </Button>
            </Group>
          ) : null}
        </Group>

        {/*
          One switch per record field, grouped into the work and the market.
          The market fields carry a sentence each: they are the ones whose
          meaning is not obvious from the label.
        */}
        <Text size="h4" mb="xs">
          About the work
        </Text>
        <Stack gap="xs" mb="md">
          {WORK_FIELDS.map((field) => (
            <Switch
              key={field}
              label={ARTWORK_FIELD_LABELS[field]}
              checked={artworkFields[field]}
              onChange={(e) => {
                // Read the value now: the updater may run after the event has
                // been dispatched, when `currentTarget` is already null.
                const checked = e.currentTarget.checked;
                setArtworkFields((current) => ({
                  ...current,
                  [field]: checked,
                }));
              }}
            />
          ))}
        </Stack>

        <Divider my="md" />

        <Text size="h4" mb="xs">
          Market &amp; acquisition
        </Text>
        <Stack gap="xs">
          {MARKET_FIELDS.map((field) => (
            <Switch
              key={field}
              label={ARTWORK_FIELD_LABELS[field]}
              description={MARKET_DESCRIPTIONS[field]}
              checked={artworkFields[field]}
              onChange={(e) => {
                // Same reason as the group above: capture before the updater.
                const checked = e.currentTarget.checked;
                setArtworkFields((current) => ({
                  ...current,
                  [field]: checked,
                }));
              }}
            />
          ))}
        </Stack>

        <Text size="sm" c="dimmed" mt="md">
          Turning a field off keeps any values already recorded. They return
          when you switch it back on.
        </Text>
      </Card>

      <Group justify="center" mt="xl">
        <Button type="submit" loading={saving} disabled={clean}>
          Save
        </Button>
      </Group>
    </form>
  );
};

export default GeneralTab;
