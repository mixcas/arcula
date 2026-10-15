import React, { useState } from "react";
import {
  Container,
  TextInput,
  PasswordInput,
  Button,
  Text,
  Group,
  Alert,
  Anchor,
} from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { Link, useNavigate } from "react-router-dom";
import { authClient } from "@/auth/client";
import { toAuthError } from "@/auth/errors";
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
 * The second mode on this page is the password-reset request: it asks for an
 * address only, because the answer is always the same sentence — if the
 * address has an account, a mail is on its way. The mail's link lands on
 * the reset form, a different page.
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
  const [mode, setMode] = useState<"signup" | "reset-request">("signup");
  // Carried from the sign-up form when the visitor asks for a reset: the
  // address they just typed is the one they mean.
  const [resetEmail, setResetEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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
      // only work left is the move: the dashboard is where a fresh account
      // meets its one-collection cap.
      void navigate("/manage", { replace: true });
    } catch (err) {
      // A rejected fetch has no envelope to read: the server is not
      // answering at all, and that is not "the email exists".
      console.error("Sign up error:", err);
      setError("Sign up failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const result = await authClient.requestPasswordReset({
        email: resetEmail,
      });
      const failed = toAuthError(result, "Could not request a reset email");
      if (failed) {
        setError(
          (failed as { code?: unknown }).code === "INVALID_EMAIL"
            ? "Enter a valid email address."
            : "Could not request a reset email. Please try again.",
        );
        return;
      }
      // The endpoint answers the same for a known and an unknown address
      // (an enumeration-safe design on the server), so the notice must not
      // confirm either way.
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

  const switchToReset = () => {
    setMode("reset-request");
    // `getValues()`, not `form.values`: in uncontrolled mode the `values`
    // property is a snapshot of the last render, and typing re-renders
    // nothing (Mantine deliberately keeps the DOM in charge of the inputs).
    // The live value is the internal ref `getValues()` reads — the same one
    // the submit path validates and transforms.
    setResetEmail(form.getValues().email);
    setError(null);
    setNotice(null);
  };

  if (mode === "reset-request") {
    return (
      <Container
        size="sm"
        style={{ paddingTop: "2rem", paddingBottom: "2rem" }}
      >
        <Text size="h2">Reset your password</Text>

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
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
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
          <Link to="/signup">Back to sign up</Link>
        </Text>
      </Container>
    );
  }

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
          {...form.getInputProps("password")}
        />

        <Group mt="xl">
          <Button type="submit" loading={loading}>
            Sign up
          </Button>
        </Group>
      </form>

      <Text mt="md">
        <Anchor component="button" onClick={switchToReset} ta="left">
          Forgot your password?
        </Anchor>
      </Text>

      <Text mt="xl">
        Already have an account? <Link to="/login">Login</Link>
      </Text>
    </Container>
  );
};

export default SignUpPage;
