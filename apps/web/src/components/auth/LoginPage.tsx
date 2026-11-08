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
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { returnPathFrom, returnStateFor } from "@/utils/returnPath";
import { resetRequestStateFor } from "@/utils/resetRequest";

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const location = useLocation();
  const { login, currentUser } = useAuth();

  // Where a successful sign-in lands: the page that bounced the visitor here
  // (ProtectedRoute puts it in router state), or the manage dashboard when
  // they arrived from a public page's plain <Link>, which carries no state.
  const from = returnPathFrom(location.state);
  // The same return path rides the cross-link: a visitor who lands here from
  // an invitation and decides to create an account must come back to it, not
  // lose the link on the way through sign-up.
  const crossLinkState = from ? returnStateFor(from) : undefined;

  // Leave on the session, not on the sign-in call. The client's session atom
  // refetches only after its own signal fires (a tick after the successful
  // POST), so `await login()` resolves while `currentUser` is still null.
  // Navigating then would land on ProtectedRoute, which answers "no user" and
  // bounces straight back here — a flash of an empty form, and the visitor's
  // second attempt is the one that works because the atom has caught up by
  // then. Rendering the redirect off `currentUser` waits for the one fact the
  // guard actually reads, whatever the ordering. It also means an already
  // signed-in visitor never sees the form.
  if (currentUser) {
    return <Navigate to={from ?? "/manage"} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Sign in with email and password.
      await login(email, password);
      // Signed in; the session lands in the atom a moment later and the
      // redirect above takes over. `loading` stays on so the form does not
      // invite a second submit in the gap — it is about to unmount.
    } catch (err: unknown) {
      console.error("Login error:", err);
      // AuthProvider rethrows the sign-in's error object: the response
      // body plus status — { message, code, status, statusText }. Two
      // codes reach this form — 401 INVALID_EMAIL_OR_PASSWORD (better
      // auth's enumeration-safe merge of unknown-email and wrong-password)
      // and 400 INVALID_EMAIL (malformed address, rejected before the DB
      // is touched). Anything else falls through to the generic message.
      const status =
        err && typeof err === "object" && "status" in err
          ? (err as { status?: unknown }).status
          : undefined;
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code?: unknown }).code
          : undefined;
      if (status === 401 && code === "INVALID_EMAIL_OR_PASSWORD") {
        setError("Invalid email or password.");
      } else if (status === 400 && code === "INVALID_EMAIL") {
        setError("Invalid email address format.");
      } else {
        setError("Login failed. Please try again.");
      }
      setLoading(false);
    }
  };

  return (
    <Container size="sm" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
      <Text size="h2">Login to Arcula</Text>

      {error && <Alert mt="md">{error}</Alert>}

      <form onSubmit={(e) => void handleSubmit(e)}>
        <TextInput
          label="Email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          mt="md"
        />

        <PasswordInput
          label="Password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          mt="md"
        />

        {/* The reset door sits beside the field a collector has just
            mistyped, and carries whatever address is already typed. */}
        <Group justify="flex-end" mt={6}>
          <Anchor
            component={Link}
            to="/reset-password"
            state={resetRequestStateFor(email)}
            size="sm"
          >
            Forgot your password?
          </Anchor>
        </Group>

        <Group mt="xl">
          <Button type="submit" loading={loading}>
            Login
          </Button>
        </Group>
      </form>

      <Text mt="xl">
        Don't have an account?{" "}
        <Link to="/signup" state={crossLinkState}>
          Sign up
        </Link>
      </Text>
    </Container>
  );
};

export default LoginPage;
