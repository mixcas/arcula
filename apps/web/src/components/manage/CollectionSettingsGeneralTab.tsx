/**
 * The settings page's General tab: the collection's own facts — name,
 * description, public or private, and the password control.
 *
 * Its Save writes only this tab's fields: the decision in
 * `collectionSettingsSave` answers the payload, and the tab is clean — Save
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
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import type { Collection } from "@arcula/shared";
import { passwordControlMode } from "./collectionPassword";
import {
  resolveGeneralSave,
  type GeneralEditedValues,
} from "./collectionSettingsSave";

interface GeneralTabProps {
  /** The document the page last loaded or saved — the tab's "loaded" side. */
  collection: Collection;
  saving: boolean;
  /** The page's save: it re-derives the payload and posts it. */
  onSave: (edited: GeneralEditedValues) => void | Promise<void>;
}

const GeneralTab: React.FC<GeneralTabProps> = ({
  collection,
  saving,
  onSave,
}) => {
  // The editable buffers, apart from the loaded values for the same reason
  // the old form kept them apart: the save compares against the loaded
  // values, and folding them into one field would make "changed" always true.
  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description ?? "");
  const [isPublic, setIsPublic] = useState(collection.isPublic === true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // The two deliberate states beyond "show the fields": changing a password
  // that is already set, and a removal waiting for Save.
  const [editingPassword, setEditingPassword] = useState(false);
  const [removingPassword, setRemovingPassword] = useState(false);

  const edited: GeneralEditedValues = {
    name,
    description,
    isPublic,
    password,
    confirm: confirmPassword,
    editingPassword,
    removingPassword,
  };

  // The same answer that becomes the wire body: clean — Save stays off —
  // exactly when it is an empty payload. An error keeps Save offered.
  const decision = resolveGeneralSave(
    {
      name: collection.name,
      description: collection.description ?? null,
      isPublic: collection.isPublic === true,
      isPasswordProtected: collection.isPasswordProtected === true,
    },
    edited,
  );
  const clean =
    decision.kind === "payload" && Object.keys(decision.payload).length === 0;

  const passwordMode = passwordControlMode({
    isPublic,
    isPasswordProtected: collection.isPasswordProtected === true,
    editing: editingPassword,
    removing: removingPassword,
  });

  return (
    <Card shadow="sm" p="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(edited);
        }}
      >
        <TextInput
          label="Collection Name"
          placeholder="Name of your collection"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          mb="md"
        />

        <Textarea
          label="Description"
          description="Shown on the public view's first artwork."
          placeholder="Enter collection description (optional)"
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

        <Text>Make Collection Public</Text>
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
            // The password control disappears on a private collection.
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
          private collection shows nothing: there is no visitor in front of
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
              Anyone with the link will be able to read this collection again as
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
              description="Visitors need this password to read the collection."
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

        <Group justify="center" mt="xl">
          <Button type="submit" loading={saving} disabled={clean}>
            Save
          </Button>
        </Group>
      </form>
    </Card>
  );
};

export default GeneralTab;
