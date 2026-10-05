import React, { useState } from "react";
import {
  Card,
  Text,
  TextInput,
  PasswordInput,
  Button,
  Group,
  Alert,
  Loader,
  Divider,
} from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useAuth } from "@/hooks/useAuth";
import { meService } from "@/services/meService";
import { authClient } from "@/auth/client";
import { toAuthError } from "@/auth/errors";
import type { MePatchPayload, SessionUserRead } from "@arcula/shared";
import {
  changePasswordSchema,
  profileNameSchema,
  type ChangePasswordFormValues,
  type ProfileNameFormValues,
} from "@/schemas/user";

/**
 * The account profile (Phase 5, plan §12): first/last name through
 * `PATCH /me`, the password through Better Auth's native
 * `change-password` — Auth owns the credential, so the re-authentication
 * dance the old plan described (reauthenticateWithCredential) is the
 * endpoint's own `currentPassword` check. Email change is out of scope
 * (plan §5) and shown as read-only, not omitted — the field is there,
 * it just is not this page's to move.
 *
 * The avatar (the user row's `image` column) is Phase 8.
 */

/**
 * The native codes a change-password failure carries. `INVALID_PASSWORD`
 * and a too-short new password are different mistakes with different
 * fixes, so they get different lines; everything else stays generic.
 */
function mapChangePasswordError(err: Error): string {
  const code = (err as { code?: unknown }).code;
  if (code === "INVALID_PASSWORD") {
    return "Current password is incorrect.";
  }
  if (code === "PASSWORD_TOO_SHORT") {
    return "New password must be at least 8 characters.";
  }
  return "Could not change the password. Please try again.";
}

/**
 * The two forms, mounted only once /me has answered: the name form's
 * initial values come from the profile, so mounting earlier would render
 * empty fields over a real name and the save's changed-vs-loaded compare
 * would have nothing to load against.
 */
const ProfileForms: React.FC<{ me: SessionUserRead }> = ({ me }) => {
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);

  const [passwordChanged, setPasswordChanged] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

  const nameForm = useForm<ProfileNameFormValues, ProfileNameFormValues>({
    mode: "uncontrolled",
    initialValues: {
      firstName: me.firstName ?? "",
      lastName: me.lastName ?? "",
    },
    validateInputOnBlur: true,
    validate: schemaResolver(profileNameSchema, { sync: true }),
    // The schema's output is the trimmed value; the comparison below needs
    // it, and Mantine hands the raw input string to the transform.
    transformValues: (values) => profileNameSchema.parse(values),
  });

  const passwordForm = useForm<
    ChangePasswordFormValues,
    { currentPassword: string; newPassword: string }
  >({
    mode: "uncontrolled",
    initialValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    validateInputOnBlur: true,
    validate: schemaResolver(changePasswordSchema, { sync: true }),
    transformValues: (values) => ({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    }),
  });

  const saveName = async (values: ProfileNameFormValues) => {
    // Absent keys leave the row alone, and a blank is not a value there is
    // any writing it with: build the payload from the changed, non-blank
    // halves only. Nothing changed is no write at all, not a no-op PATCH.
    const patch: MePatchPayload = {};
    if (values.firstName && values.firstName !== (me.firstName ?? "")) {
      patch.firstName = values.firstName;
    }
    if (values.lastName && values.lastName !== (me.lastName ?? "")) {
      patch.lastName = values.lastName;
    }
    if (Object.keys(patch).length === 0) return;

    setNameSaving(true);
    setNameError(null);
    setNameSaved(false);
    try {
      await meService.updateProfile(patch);
      setNameSaved(true);
    } catch (err) {
      console.error("Error saving profile:", err);
      setNameError("Failed to save your name. Please try again.");
    } finally {
      setNameSaving(false);
    }
  };

  const changePassword = async (payload: {
    currentPassword: string;
    newPassword: string;
  }) => {
    setPasswordSaving(true);
    setPasswordError(null);
    setPasswordChanged(false);
    try {
      const result = await authClient.changePassword({
        currentPassword: payload.currentPassword,
        newPassword: payload.newPassword,
      });
      const failed = toAuthError(result, "Could not change the password");
      if (failed) {
        setPasswordError(mapChangePasswordError(failed));
        return;
      }
      setPasswordChanged(true);
      // The credentials must not sit in the inputs after the change:
      // reset repoints the uncontrolled inputs at the empty initial values.
      passwordForm.reset();
    } catch (err) {
      console.error("Error changing password:", err);
      setPasswordError("Could not change the password. Please try again.");
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <>
      <Text size="h2" mb="xl">
        Profile
      </Text>

      <Card withBorder>
        <Group align="flex-start" justify="space-between" mb="md">
          <div>
            <Text fw="600">Name</Text>
            <Text size="sm" c="dim" tt="uppercase">
              {me.email}
            </Text>
          </div>
        </Group>

        {nameError && (
          <Alert color="red" mb="md">
            {nameError}
          </Alert>
        )}
        {nameSaved && (
          <Alert color="green" mb="md">
            Profile updated.
          </Alert>
        )}

        <form onSubmit={(e) => void nameForm.onSubmit(saveName)(e)}>
          <Group grow>
            <TextInput
              key={nameForm.key("firstName")}
              label="First name"
              placeholder="First name"
              {...nameForm.getInputProps("firstName")}
            />
            <TextInput
              key={nameForm.key("lastName")}
              label="Last name"
              placeholder="Last name (optional)"
              {...nameForm.getInputProps("lastName")}
            />
          </Group>
          <Group mt="md">
            <Button type="submit" loading={nameSaving}>
              Save name
            </Button>
          </Group>
        </form>

        <Divider my="lg" />

        {passwordError && (
          <Alert color="red" mb="md">
            {passwordError}
          </Alert>
        )}
        {passwordChanged && (
          <Alert color="green" mb="md">
            Password changed.
          </Alert>
        )}

        <form onSubmit={(e) => void passwordForm.onSubmit(changePassword)(e)}>
          <Text fw="600" mb="md">
            Change password
          </Text>
          <PasswordInput
            key={passwordForm.key("currentPassword")}
            label="Current password"
            placeholder="Current password"
            required
            {...passwordForm.getInputProps("currentPassword")}
          />
          <PasswordInput
            key={passwordForm.key("newPassword")}
            label="New password"
            placeholder="At least 8 characters"
            required
            mt="md"
            {...passwordForm.getInputProps("newPassword")}
          />
          <PasswordInput
            key={passwordForm.key("confirmPassword")}
            label="Confirm new password"
            placeholder="Repeat the new password"
            required
            mt="md"
            {...passwordForm.getInputProps("confirmPassword")}
          />
          <Group mt="md">
            <Button type="submit" loading={passwordSaving} variant="outline">
              Change password
            </Button>
          </Group>
        </form>
      </Card>
    </>
  );
};

const ProfilePage: React.FC = () => {
  const { me } = useAuth();

  // /me is in flight (or failed — the provider degrades to null and the
  // tier UI falls back free): the forms need the loaded profile for their
  // initial values, so there is nothing to show but the wait.
  if (!me) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    );
  }

  return <ProfileForms me={me} />;
};

export default ProfilePage;
