import React, { useState } from "react";
import {
  Container,
  PasswordInput,
  Button,
  Text,
  Group,
  Alert,
} from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { Link, useParams } from "react-router-dom";
import { authClient } from "@/auth/client";
import { toAuthError } from "@/auth/errors";
import {
  resetPasswordSchema,
  type ResetPasswordFormValues,
} from "@/schemas/user";

/**
 * The reset form the reset mail's link lands on (`/reset-password/<token>`,
 * Phase 5). The API side has been live since the mail provider landed —
 * this page is the half the link pointed at but was missing.
 *
 * The token comes from the URL and is not shown: it is neither an input
 * nor state, it is just part of the request, so a stale link fails with
 * the server's `INVALID_TOKEN` rather than doing anything surprising.
 */

function mapResetError(err: Error): string {
  const code = (err as { code?: unknown }).code;
  if (code === "INVALID_TOKEN") {
    return "This reset link is invalid or has expired. Request a new one.";
  }
  if (code === "PASSWORD_TOO_SHORT") {
    return "Password must be at least 8 characters.";
  }
  return "Could not reset the password. Please try again.";
}

const ResetPasswordPage: React.FC = () => {
  const { token = "" } = useParams<{ token: string }>();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const form = useForm<ResetPasswordFormValues, { newPassword: string }>({
    mode: "uncontrolled",
    initialValues: { newPassword: "", confirmPassword: "" },
    validateInputOnBlur: true,
    validate: schemaResolver(resetPasswordSchema, { sync: true }),
    // The confirm field exists to check the first; the payload carries only
    // the new password.
    transformValues: (values) => ({ newPassword: values.newPassword }),
  });

  const handleReset = async (payload: { newPassword: string }) => {
    setError(null);
    setLoading(true);
    try {
      const result = await authClient.resetPassword({
        newPassword: payload.newPassword,
        token,
      });
      const failed = toAuthError(result, "Could not reset the password");
      if (failed) {
        setError(mapResetError(failed));
        return;
      }
      setDone(true);
    } catch (err) {
      console.error("Reset password error:", err);
      setError("Could not reset the password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container size="sm" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Text size="h2">Set a new password</Text>

      {error && (
        <Alert mt="md" color="red">
          {error}
        </Alert>
      )}
      {done ? (
        <Alert mt="md" color="green">
          Password updated. <Link to="/login">Sign in</Link>.
        </Alert>
      ) : (
        <form onSubmit={(e) => void form.onSubmit(handleReset)(e)}>
          <PasswordInput
            key={form.key("newPassword")}
            label="New password"
            placeholder="At least 8 characters"
            required
            mt="md"
            {...form.getInputProps("newPassword")}
          />
          <PasswordInput
            key={form.key("confirmPassword")}
            label="Confirm new password"
            placeholder="Repeat the new password"
            required
            mt="md"
            {...form.getInputProps("confirmPassword")}
          />

          <Group mt="xl">
            <Button type="submit" loading={loading}>
              Update password
            </Button>
          </Group>
        </form>
      )}
    </Container>
  );
};

export default ResetPasswordPage;
