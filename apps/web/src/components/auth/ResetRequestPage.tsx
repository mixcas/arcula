import React, { useState } from "react";
import {
  Alert,
  Button,
  Container,
  Group,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Link, useLocation } from "react-router-dom";
import { authClient } from "@/auth/client";
import { toAuthError } from "@/auth/errors";
import { resetRequestEmailFrom } from "@/utils/resetRequest";

/**
 * The reset request screen (`/reset-password`), reached from sign-in.
 *
 * It asks for an address and answers the same sentence whether or not an
 * account exists: the endpoint is enumeration-safe, and the page must not undo
 * that by inferring anything from the response. The mailed link does not land
 * here — it lands on the reset form beside this route, `/reset-password/:token`.
 *
 * The address sign-in was holding arrives in router state; a visitor who
 * followed a bookmark gets an empty field (see `utils/resetRequest.ts`).
 */
const ResetRequestPage: React.FC = () => {
  const location = useLocation();
  const [email, setEmail] = useState(() =>
    resetRequestEmailFrom(location.state),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const result = await authClient.requestPasswordReset({ email });
      const failed = toAuthError(result, "Could not request a reset email");
      if (failed) {
        setError(
          (failed as { code?: unknown }).code === "INVALID_EMAIL"
            ? "Enter a valid email address."
            : "Could not request a reset email. Please try again.",
        );
        return;
      }
      // A known and an unknown address answer identically, so the notice must
      // not confirm either way.
      setNotice(
        "If an account exists for that address, a reset email is on its way.",
      );
    } catch (err) {
      console.error("Reset request error:", err);
      setError("Could not request a reset email. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container size="sm" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Title order={2}>Reset your password</Title>

      {error && (
        <Alert mt="md" color="red">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert mt="md" color="green">
          {notice}
        </Alert>
      )}

      {!notice ? (
        <form onSubmit={(e) => void requestReset(e)}>
          <TextInput
            label="Email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            type="email"
            mt="md"
          />
          <Group mt="xl">
            <Button type="submit" loading={loading}>
              Send reset email
            </Button>
          </Group>
        </form>
      ) : null}

      <Text mt="xl">
        <Link to="/login">Back to sign in</Link>
      </Text>
    </Container>
  );
};

export default ResetRequestPage;
