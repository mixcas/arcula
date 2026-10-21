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
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { returnPathFrom, returnStateFor } from "@/utils/returnPath";

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  // Where a successful sign-in lands: the page that bounced the visitor here
  // (ProtectedRoute puts it in router state), or the manage dashboard when
  // they arrived from a public page's plain <Link>, which carries no state.
  const from = returnPathFrom(location.state);
  // The same return path rides the cross-link: a visitor who lands here from
  // an invitation and decides to create an account must come back to it, not
  // lose the link on the way through sign-up.
  const crossLinkState = from ? returnStateFor(from) : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Sign in with email and password.
      await login(email, password);

      // Redirect to the intended destination after successful login
      void navigate(from ?? "/manage", { replace: true });
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
    } finally {
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
