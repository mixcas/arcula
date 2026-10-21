/**
 * The invitation landing page (`/invite/:token`), where the mail's link lands.
 *
 * It answers one question before anything is written: who is looking at this
 * invitation? A visitor sees what they would join and the two doors — sign in
 * or create an account — both carrying the invite path, so the auth round trip
 * comes back here. The invited account can accept or decline; another account
 * sees whose invitation it is and can switch. Accepting lands in the collection
 * itself.
 *
 * The token is only ever the route's segment on the request: it is not put in
 * component state, storage or a log, and no response is logged with it.
 *
 * Every dead link — unknown, expired, revoked, consumed — is the API's one
 * uniform `not-found`, so this page renders one state for all of them and
 * discloses no reason.
 */

import React, { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Link, useNavigate, useParams } from "react-router-dom";
import dayjs from "dayjs";
import { collectionSlug, type InvitationPreview } from "@arcula/shared";
import { authClient } from "@/auth/client";
import { toAuthError } from "@/auth/errors";
import { useAuth } from "@/hooks/useAuth";
import { ApiRequestError, isNotFound } from "@/services/api";
import { invitationService } from "@/services/invitationService";
import { invitationAudience } from "@/utils/invitation";
import { returnStateFor } from "@/utils/returnPath";

type PageState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "failed" }
  | { status: "preview"; preview: InvitationPreview }
  | { status: "declined"; preview: InvitationPreview };

type Busy = "accept" | "decline" | "switch" | null;

const InvitationPage: React.FC = () => {
  const { token = "" } = useParams<{ token: string }>();
  // Keyed on the token: a different link is a different invitation, and the
  // view starts from its loading state rather than showing the previous
  // link's details while the next read is in flight.
  return <InvitationView key={token} token={token} />;
};

const InvitationView: React.FC<{ token: string }> = ({ token }) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  const [state, setState] = useState<PageState>({ status: "loading" });
  // A retry re-runs the same read without remounting the route.
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The address from the API's own refusal, when the server disagrees with
  // the client-side comparison (a session that changed under the page). Once
  // set, the page is mismatched whatever `currentUser` says.
  const [refusedEmail, setRefusedEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    invitationService
      .getInvitation(token)
      .then((preview) => {
        if (cancelled) return;
        setState(
          preview ? { status: "preview", preview } : { status: "not-found" },
        );
      })
      .catch(() => {
        // Deliberately not logging the error: the request path carries the
        // raw token, and a dead preview is not a reason to write it down.
        if (!cancelled) setState({ status: "failed" });
      });

    return () => {
      cancelled = true;
    };
  }, [token, reloadKey]);

  const retry = () => {
    setState({ status: "loading" });
    setActionError(null);
    setRefusedEmail(null);
    setReloadKey((key) => key + 1);
  };

  const preview =
    state.status === "preview" || state.status === "declined"
      ? state.preview
      : null;
  const invitedEmail = refusedEmail ?? preview?.email ?? "";
  const audience = refusedEmail
    ? "mismatched"
    : invitationAudience(invitedEmail, currentUser);
  const returnState = returnStateFor(`/invite/${token}`);
  const expiresAt = preview ? new Date(preview.expiresAt.seconds * 1000) : null;

  const handleAccept = async () => {
    if (!preview) return;
    setBusy("accept");
    setActionError(null);
    try {
      const outcome = await invitationService.acceptInvitation(token);
      if (outcome.status === "wrong-account") {
        setRefusedEmail(outcome.email);
        return;
      }
      void navigate(
        `/manage/collection/${collectionSlug(
          outcome.collection.name,
          outcome.collection.id,
        )}`,
        { replace: true },
      );
    } catch (err) {
      if (isNotFound(err)) {
        setState({ status: "not-found" });
        return;
      }
      if (err instanceof ApiRequestError && err.status === 409) {
        setActionError("You already have access to this collection.");
        return;
      }
      setActionError("Could not accept the invitation. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleDecline = async () => {
    if (!preview) return;
    setBusy("decline");
    setActionError(null);
    try {
      const declined = await invitationService.declineInvitation(token);
      if (declined.status !== "declined") {
        setActionError("Could not decline the invitation. Please try again.");
        return;
      }
      setState({ status: "declined", preview });
    } catch (err) {
      if (isNotFound(err)) {
        setState({ status: "not-found" });
        return;
      }
      setActionError("Could not decline the invitation. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleSwitchAccount = async () => {
    setBusy("switch");
    setActionError(null);
    try {
      const result = await authClient.signOut();
      if (toAuthError(result, "Could not sign out")) {
        setActionError("Could not switch accounts. Please try again.");
        return;
      }
      void navigate("/login", { state: returnState, replace: true });
    } catch {
      setActionError("Could not switch accounts. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Container size="sm" py="xl">
      {state.status === "loading" && (
        <Group justify="center" py="xl">
          <Loader role="status" aria-label="Loading invitation" />
        </Group>
      )}

      {state.status === "not-found" && (
        <Paper withBorder p="xl" data-testid="invitation-not-found">
          <Title order={2}>This invitation is not available</Title>
          <Text mt="md" c="dim">
            This link is no longer valid. Ask the person who invited you to send
            a new one.
          </Text>
          <Button mt="xl" component={Link} to="/" variant="subtle">
            Back to Arcula
          </Button>
        </Paper>
      )}

      {state.status === "failed" && (
        <Paper withBorder p="xl" data-testid="invitation-failed">
          <Title order={2}>The invitation could not be loaded</Title>
          <Text mt="md" c="dim">
            Something went wrong. Please try again.
          </Text>
          <Button mt="xl" variant="outline" onClick={retry}>
            Try again
          </Button>
        </Paper>
      )}

      {preview && (
        <Paper withBorder p="xl">
          <Stack gap="md">
            <div>
              <Text size="sm" c="dim">
                Invitation
              </Text>
              <Title order={2}>{preview.collection.name}</Title>
            </div>

            <Text>
              {preview.inviter.name} invited you to collaborate on this
              collection.
            </Text>
            <Text>
              Sent to{" "}
              <Text span fw={600} data-testid="invitation-email">
                {invitedEmail}
              </Text>
              .
            </Text>
            {expiresAt && (
              <Text size="sm" c="dim">
                This invitation expires on{" "}
                <time
                  dateTime={expiresAt.toISOString()}
                  data-testid="invitation-expiry"
                >
                  {dayjs(expiresAt).format("D MMMM YYYY")}
                </time>
                .
              </Text>
            )}

            {actionError && (
              <Alert color="red" data-testid="invitation-action-error">
                {actionError}
              </Alert>
            )}

            {state.status === "declined" ? (
              <>
                <Alert
                  color="green"
                  title="Invitation declined"
                  data-testid="invitation-declined"
                >
                  You declined the invitation to {preview.collection.name}.
                </Alert>
                <Group>
                  <Button component={Link} to="/manage" variant="outline">
                    Go to your dashboard
                  </Button>
                </Group>
              </>
            ) : audience === "signed-out" ? (
              <>
                <Text>
                  Sign in or create an account with {invitedEmail} to answer it.
                </Text>
                <Group>
                  <Button component={Link} to="/login" state={returnState}>
                    Sign in
                  </Button>
                  <Button
                    component={Link}
                    to="/signup"
                    state={returnState}
                    variant="outline"
                  >
                    Create an account
                  </Button>
                </Group>
              </>
            ) : audience === "matching" ? (
              <Group>
                <Button
                  onClick={() => void handleAccept()}
                  loading={busy === "accept"}
                  disabled={busy !== null}
                >
                  Accept invitation
                </Button>
                <Button
                  variant="subtle"
                  color="red"
                  onClick={() => void handleDecline()}
                  loading={busy === "decline"}
                  disabled={busy !== null}
                >
                  Decline
                </Button>
              </Group>
            ) : (
              <>
                <Alert
                  color="yellow"
                  title="This invitation is for another account"
                >
                  It was sent to {invitedEmail}, but you are signed in as{" "}
                  {currentUser?.email ?? "another account"}. Switch accounts to
                  answer it.
                </Alert>
                <Group>
                  <Button
                    variant="outline"
                    onClick={() => void handleSwitchAccount()}
                    loading={busy === "switch"}
                    disabled={busy !== null}
                  >
                    Switch account
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Paper>
      )}
    </Container>
  );
};

export default InvitationPage;
