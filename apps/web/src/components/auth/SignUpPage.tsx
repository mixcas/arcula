import React, { useState } from "react";
import {
  Container,
  TextInput,
  PasswordInput,
  Button,
  Text,
  Group,
  Alert,
} from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { authClient } from "@/auth/client";
import { toAuthError } from "@/auth/errors";
import { returnPathFrom, returnStateFor } from "@/utils/returnPath";
import {
  EMPTY_SIGN_UP_FORM,
  signUpSchema,
  toSignUpPayload,
  type SignUpFormValues,
  type SignUpPayload,
} from "@/schemas/user";

/**
 * The beta sign-up screen: name, email and password in one Better Auth
 * sign-up — the custom first/last fields ride the same body, so a fresh
 * account lands with its profile half set.
 *
 * This page is about signing up, and nothing else. A collector who has
 * forgotten a password reaches the reset request from sign-in, the page that
 * exists for them; see `ResetRequestPage`.
 */

/**
 * The native codes a sign-up failure carries (Better Auth, not the API
 * envelope — `/api/auth/*` keeps its own response shape). Everything else
 * stays generic so the alert does not leak a status line.
 */
function mapSignUpError(err: Error): string {
  const status = (err as { status?: unknown }).status;
  const code = (err as { code?: unknown }).code;
  if (status === 422 && code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
    return "An account with that email already exists.";
  }
  if (status === 400 && code === "INVALID_EMAIL") {
    return "Enter a valid email address.";
  }
  if (status === 400 && code === "PASSWORD_TOO_SHORT") {
    return "Password must be at least 8 characters.";
  }
  return "Sign up failed. Please try again.";
}

const SignUpPage: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Where a successful sign-up lands: whoever sent the visitor here (the
  // invitation page puts its own path in router state) or the dashboard for a
  // plain arrival. Same rule the login page follows — state is not
  // user-addressable, so there is no open redirect to sanitise.
  const from = returnPathFrom(location.state);
  const crossLinkState = from ? returnStateFor(from) : undefined;

  // The sign-up form (the plan's `src/schemas/user.ts` pattern): a Zod
  // schema through `schemaResolver` against the hand-written values type,
  // and `transformValues` shaping the trimmed output into the payload.
  const form = useForm<SignUpFormValues, SignUpPayload>({
    mode: "uncontrolled",
    initialValues: EMPTY_SIGN_UP_FORM,
    validateInputOnBlur: true,
    validate: schemaResolver(signUpSchema, { sync: true }),
    transformValues: toSignUpPayload,
  });

  const handleSignUp = async (payload: SignUpPayload) => {
    setError(null);
    setLoading(true);
    try {
      const result = await authClient.signUp.email(payload);
      const failed = toAuthError(result, "Sign up failed");
      if (failed) {
        setError(mapSignUpError(failed));
        return;
      }
      // The sign-up establishes the session (auto-sign-in is on), so the
      // only work left is the move: the invite page that sent the visitor
      // here, or the dashboard, where a fresh account meets its
      // one-collection cap.
      void navigate(from ?? "/manage", { replace: true });
    } catch (err) {
      // A rejected fetch has no envelope to read: the server is not
      // answering at all, and that is not "the email exists".
      console.error("Sign up error:", err);
      setError("Sign up failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container size="sm" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Text size="h2">Create your account</Text>

      {error && (
        <Alert mt="md" color="red">
          {error}
        </Alert>
      )}

      <form onSubmit={(e) => void form.onSubmit(handleSignUp)(e)}>
        <Group grow>
          <TextInput
            key={form.key("firstName")}
            label="First name"
            placeholder="First name"
            required
            {...form.getInputProps("firstName")}
          />
          <TextInput
            key={form.key("lastName")}
            label="Last name"
            placeholder="Last name (optional)"
            {...form.getInputProps("lastName")}
          />
        </Group>

        <TextInput
          key={form.key("email")}
          label="Email"
          placeholder="your@email.com"
          required
          mt="md"
          {...form.getInputProps("email")}
        />

        <PasswordInput
          key={form.key("password")}
          label="Password"
          placeholder="At least 8 characters"
          required
          mt="md"
          autoComplete="new-password"
          {...form.getInputProps("password")}
        />

        <PasswordInput
          key={form.key("confirmPassword")}
          label="Confirm password"
          placeholder="Repeat the password"
          required
          mt="md"
          autoComplete="new-password"
          {...form.getInputProps("confirmPassword")}
        />

        <Group mt="xl">
          <Button type="submit" loading={loading}>
            Sign up
          </Button>
        </Group>
      </form>

      <Text mt="xl">
        Already have an account?{" "}
        <Link to="/login" state={crossLinkState}>
          Login
        </Link>
      </Text>
    </Container>
  );
};

export default SignUpPage;
