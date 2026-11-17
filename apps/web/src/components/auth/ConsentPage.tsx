// The consent screen: the app's own page for approving a Connection.
//
// The OAuth provider has no UI. Its authorize endpoint redirects here with the
// whole authorization query re-signed, and this page is where a person sees
// who is asking, where it will send them back, and which account it will act
// as — then accepts or denies. The server does the verification; the page
// renders what `/api/v1/connections/request` answered and posts the same
// verified query back to the provider.
//
// The client's name is attacker-chosen (it comes from the metadata document
// the client hosts), so the redirect host is rendered beside it, and a link
// only appears when the API kept it as an `https:` URL.

import React, { useEffect, useState } from "react";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Container,
  Group,
  List,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { Navigate, useLocation } from "react-router-dom";
import type { ConnectionRequestRead } from "@arcula/shared";
import { useAuth } from "@/hooks/useAuth";
import { connectionService } from "@/services/connectionService";

const SCOPE_LABELS: Record<string, string> = {
  "mcp:read": "Read your Catalogues and Artworks",
  "mcp:write": "Create and change Catalogues and Artworks",
  offline_access: "Stay connected without asking you to sign in again",
  openid: "Confirm your identity",
  profile: "Read your name",
  email: "Read your email address",
};

const ConsentPage: React.FC = () => {
  const location = useLocation();
  const { currentUser } = useAuth();
  const [request, setRequest] = useState<ConnectionRequestRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<"accept" | "deny" | null>(null);

  const search = location.search;

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    connectionService
      .getRequest(search)
      .then((read) => {
        if (!cancelled) setRequest(read);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("Connection request error:", err);
        setError(
          err instanceof Error
            ? err.message
            : "This connection request could not be read.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser, search]);

  // Arriving signed out (a session that ended in another tab): the provider's
  // login page is where the query survives, so send it back there.
  if (!currentUser) {
    return <Navigate to={`/login${search}`} replace />;
  }

  const decide = async (accept: boolean) => {
    if (!request) return;
    setDeciding(accept ? "accept" : "deny");
    setError(null);
    try {
      const next = await connectionService.decide(request.oauthQuery, accept);
      // The client's own redirect URI: leave the app for it.
      window.location.assign(next.url);
    } catch (err: unknown) {
      console.error("Connection decision error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "The decision could not be sent. Try again.",
      );
      setDeciding(null);
    }
  };

  return (
    <Container size="sm" py="xl">
      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      {!request && !error && (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      )}

      {request && (
        <Card withBorder>
          <Text size="h2" mb="md">
            Connect {request.client.name} to Arcula?
          </Text>

          <Stack gap="sm">
            <Text size="sm">
              <Text span fw={600}>
                {request.client.name}
              </Text>{" "}
              is asking to act as{" "}
              <Text span fw={600}>
                {currentUser.email ?? currentUser.displayName ?? "this account"}
              </Text>
              . Anything it does is your account&apos;s doing, and you can
              disconnect it later from your profile.
            </Text>

            <Text size="sm" c="dimmed">
              After you decide, it will send you back to{" "}
              <Text span fw={600}>
                {request.redirectHost}
              </Text>
              .
            </Text>

            <Text size="sm" fw={600} mt="sm">
              It is asking to:
            </Text>
            <List size="sm" spacing={4}>
              {request.scopes.map((scope) => (
                <List.Item key={scope}>
                  {SCOPE_LABELS[scope] ?? scope}
                </List.Item>
              ))}
            </List>

            {(request.client.uri ||
              request.client.tos ||
              request.client.policy) && (
              <Group gap="md" mt="xs">
                {request.client.uri && (
                  <Anchor
                    href={request.client.uri}
                    target="_blank"
                    rel="noreferrer noopener"
                    size="sm"
                  >
                    Client website
                  </Anchor>
                )}
                {request.client.tos && (
                  <Anchor
                    href={request.client.tos}
                    target="_blank"
                    rel="noreferrer noopener"
                    size="sm"
                  >
                    Terms
                  </Anchor>
                )}
                {request.client.policy && (
                  <Anchor
                    href={request.client.policy}
                    target="_blank"
                    rel="noreferrer noopener"
                    size="sm"
                  >
                    Privacy
                  </Anchor>
                )}
              </Group>
            )}
          </Stack>

          <Group justify="flex-end" mt="xl">
            <Button
              variant="default"
              onClick={() => void decide(false)}
              loading={deciding === "deny"}
              disabled={deciding === "accept"}
            >
              Deny
            </Button>
            <Button
              onClick={() => void decide(true)}
              loading={deciding === "accept"}
              disabled={deciding === "deny"}
            >
              Accept
            </Button>
          </Group>
        </Card>
      )}
    </Container>
  );
};

export default ConsentPage;
