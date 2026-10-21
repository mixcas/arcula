/**
 * The collection settings page's access card.
 *
 * It renders the caller's view from the access read — never from a dashboard
 * row's badge, which is not where an administrative screen may learn its role.
 * The owner gets the invite form, every pending offer (expired ones included,
 * marked and still resendable) and the collaborators with remove. A
 * collaborator gets the owner, the collaborators, and leave; the invitation
 * list and the invite form are absent because the server does not send them.
 *
 * Two warnings are not decoration: remove and leave empty the departing
 * account's staging prefix for this collection, so the confirmation says the
 * unsaved uploads are discarded. Saved works stay either way.
 *
 * A `409` is the API saying the card it rendered is stale — an offer resolved
 * elsewhere, a collaborator already removed. The message is shown as the API
 * words it, with a refresh that re-reads the access document; a generic
 * failure would leave the reader with a dead control and no next step.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import {
  invitationCreateSchema,
  invitationLapsed,
  invitationResendWaitMs,
  timestampMillis,
  type CollectionAccess,
  type CollectionMember,
  type InvitationSummary,
} from "@arcula/shared";
import { ApiRequestError } from "@/services/api";
import { accessService } from "@/services/accessService";
import { invitationService } from "@/services/invitationService";

interface AccessCardProps {
  /** The id alone: the route may carry “{slug}-{id}”, the API does not. */
  collectionId: string;
}

const MAIL_FAILED =
  "The invitation was recorded, but the email could not be sent. It stays pending — resend it from the list once the cooldown allows.";

const AccessCard: React.FC<AccessCardProps> = ({ collectionId }) => {
  const navigate = useNavigate();

  const [access, setAccess] = useState<CollectionAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // A conflict's own prose and whether a refresh is the way out. Kept apart
  // from a transport failure: only a stale read has an action to offer.
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshable, setRefreshable] = useState(false);

  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteWarning, setInviteWarning] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  // The card's own clock, so an expired badge and the resend cooldown become
  // true while the card sits open. One second is the cooldown's own grain.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    accessService
      .getAccess(collectionId)
      .then((row) => {
        if (!cancelled) setAccess(row);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [collectionId, reloadKey]);

  const refresh = useCallback(() => {
    setActionError(null);
    setRefreshable(false);
    setInviteWarning(null);
    setLoading(true);
    setLoadFailed(false);
    setReloadKey((key) => key + 1);
  }, []);

  const reportActionError = (err: unknown, fallback: string) => {
    if (err instanceof ApiRequestError) {
      // The API's words are the useful ones: "already pending" and "that
      // account does not have access" are different fixes.
      setActionError(err.message);
      setRefreshable(err.status === 409);
    } else {
      setActionError(fallback);
      setRefreshable(false);
    }
  };

  const replaceInvitation = (invitation: InvitationSummary) => {
    setAccess((current) => {
      if (!current) return current;
      const invitations = current.invitations ?? [];
      const known = invitations.some((row) => row.id === invitation.id);
      return {
        ...current,
        invitations: known
          ? invitations.map((row) =>
              row.id === invitation.id ? invitation : row,
            )
          : [...invitations, invitation],
      };
    });
  };

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailError(null);
    setActionError(null);
    setRefreshable(false);
    setInviteWarning(null);

    // The shared contract's own rule is the first check, so the field answers
    // before a round trip; the API's `400 fields.email` is the authority if
    // the two ever disagree.
    const parsed = invitationCreateSchema.safeParse({ email });
    if (!parsed.success) {
      setEmailError(
        parsed.error.issues[0]?.message ?? "Enter a valid email address",
      );
      return;
    }

    setInviting(true);
    try {
      const { invitation, emailSent } =
        await invitationService.createInvitation(
          collectionId,
          parsed.data.email,
        );
      replaceInvitation(invitation);
      setEmail("");
      // The row is the durable fact; the warning keeps it, and it stays
      // resendable without re-entering the address.
      if (!emailSent) setInviteWarning(MAIL_FAILED);
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.status === 400 &&
        err.fields?.email
      ) {
        setEmailError(err.fields.email);
      } else {
        reportActionError(
          err,
          "Could not send the invitation. Please try again.",
        );
      }
    } finally {
      setInviting(false);
    }
  };

  const handleResend = async (invitation: InvitationSummary) => {
    setActionError(null);
    setRefreshable(false);
    setInviteWarning(null);
    setResending(invitation.id);
    try {
      const { invitation: rotated, emailSent } =
        await invitationService.resendInvitation(collectionId, invitation.id);
      replaceInvitation(rotated);
      if (!emailSent) setInviteWarning(MAIL_FAILED);
    } catch (err) {
      reportActionError(
        err,
        "Could not resend the invitation. Please try again.",
      );
    } finally {
      setResending(null);
    }
  };

  const handleRevoke = async (invitation: InvitationSummary) => {
    setActionError(null);
    setRefreshable(false);
    setInviteWarning(null);
    setRevoking(invitation.id);
    try {
      const revoked = await invitationService.revokeInvitation(
        collectionId,
        invitation.id,
      );
      if (revoked.status !== "revoked") {
        setActionError("Could not revoke the invitation. Please try again.");
        return;
      }
      setAccess((current) =>
        current
          ? {
              ...current,
              invitations: (current.invitations ?? []).filter(
                (row) => row.id !== invitation.id,
              ),
            }
          : current,
      );
    } catch (err) {
      reportActionError(
        err,
        "Could not revoke the invitation. Please try again.",
      );
    } finally {
      setRevoking(null);
    }
  };

  const remove = async (member: CollectionMember) => {
    setActionError(null);
    setRefreshable(false);
    try {
      await accessService.removeCollaborator(collectionId, member.userId);
      setAccess((current) =>
        current
          ? {
              ...current,
              collaborators: current.collaborators.filter(
                (row) => row.userId !== member.userId,
              ),
            }
          : current,
      );
    } catch (err) {
      reportActionError(
        err,
        "Could not remove the collaborator. Please try again.",
      );
    }
  };

  const confirmRemove = (member: CollectionMember) => {
    modals.openConfirmModal({
      title: `Remove ${member.name}?`,
      centered: true,
      children: (
        <Text size="sm">
          {member.name} loses access to this collection immediately. Works they
          saved stay in the collection. Their unsaved uploads for this
          collection will be discarded.
        </Text>
      ),
      labels: { confirm: "Remove", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => {
        void remove(member);
      },
    });
  };

  const leave = async () => {
    setActionError(null);
    setRefreshable(false);
    try {
      await accessService.leaveCollection(collectionId);
      void navigate("/manage");
    } catch (err) {
      reportActionError(
        err,
        "Could not leave the collection. Please try again.",
      );
    }
  };

  const confirmLeave = () => {
    modals.openConfirmModal({
      title: "Leave this collection?",
      centered: true,
      children: (
        <Text size="sm">
          You lose access to this collection immediately. Works you saved stay
          in it. Your unsaved uploads for this collection will be discarded.
        </Text>
      ),
      labels: { confirm: "Leave", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => {
        void leave();
      },
    });
  };

  if (loading) {
    return (
      <Card shadow="sm" p="lg" data-testid="access-card">
        <Group justify="center">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading access…
          </Text>
        </Group>
      </Card>
    );
  }

  if (loadFailed || !access) {
    return (
      <Alert color="red" data-testid="access-load-error">
        Could not load who has access to this collection.{" "}
        <Button variant="subtle" size="compact-sm" onClick={refresh}>
          Retry
        </Button>
      </Alert>
    );
  }

  const isOwner = access.role === "owner";
  const invitations = access.invitations ?? [];

  return (
    <Card shadow="sm" p="lg" data-testid="access-card">
      <Group justify="space-between" align="center" mb="md">
        <Text size="h3">Access</Text>
        <Badge variant="light" color="gray">
          {isOwner ? "Owner" : "Collaborator"}
        </Badge>
      </Group>

      {actionError && (
        <Alert color="red" mb="md" data-testid="access-action-error">
          <Text size="sm">{actionError}</Text>
          {refreshable && (
            <Button
              variant="outline"
              size="compact-sm"
              mt="xs"
              onClick={refresh}
            >
              Refresh access
            </Button>
          )}
        </Alert>
      )}

      {isOwner && (
        <>
          <form
            onSubmit={(event) => {
              void handleInvite(event);
            }}
          >
            <Group align="flex-start" gap="sm" wrap="nowrap">
              <TextInput
                label="Email address"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                error={emailError}
                style={{ flex: 1 }}
              />
              <Button type="submit" loading={inviting} mt="lg">
                Send invitation
              </Button>
            </Group>
          </form>
          {inviteWarning && (
            <Alert color="yellow" mt="md" data-testid="access-invite-warning">
              {inviteWarning}
            </Alert>
          )}
          {invitations.length > 0 ? (
            <Stack gap="xs" mt="lg">
              <Text size="h4">Pending invitations</Text>
              {invitations.map((invitation) => {
                const lapsed = invitationLapsed(invitation.expiresAt, now);
                const waitMs = invitationResendWaitMs(
                  invitation.createdAt,
                  now,
                );
                return (
                  <Group
                    key={invitation.id}
                    justify="space-between"
                    align="center"
                    wrap="nowrap"
                    data-testid={`access-invitation-${invitation.id}`}
                  >
                    <div>
                      <Text size="sm">{invitation.email}</Text>
                      <Group gap="xs">
                        {lapsed ? (
                          <Badge color="red" variant="light">
                            Expired
                          </Badge>
                        ) : (
                          <Text size="xs" c="dimmed">
                            Expires{" "}
                            {dayjs(
                              timestampMillis(invitation.expiresAt),
                            ).format("D MMM YYYY")}
                          </Text>
                        )}
                      </Group>
                    </div>
                    <Group gap="xs">
                      <Button
                        variant="outline"
                        size="compact-sm"
                        loading={resending === invitation.id}
                        // The 60-second cooldown is the server's own window,
                        // read off the row's issue time; a control that looked
                        // live would only discover the refusal.
                        disabled={waitMs > 0}
                        onClick={() => {
                          void handleResend(invitation);
                        }}
                      >
                        Resend
                      </Button>
                      <Button
                        variant="subtle"
                        color="red"
                        size="compact-sm"
                        loading={revoking === invitation.id}
                        onClick={() => {
                          void handleRevoke(invitation);
                        }}
                      >
                        Revoke
                      </Button>
                    </Group>
                  </Group>
                );
              })}
            </Stack>
          ) : (
            <Text size="sm" c="dimmed" mt="lg">
              No pending invitations.
            </Text>
          )}
          <Divider my="md" />
        </>
      )}

      <Text size="h4">Owner</Text>
      <Group data-testid="access-owner" mt="xs">
        <div>
          <Text size="sm">{access.owner.name}</Text>
          <Text size="xs" c="dimmed">
            {access.owner.email}
          </Text>
        </div>
      </Group>

      <Divider my="md" />

      <Text size="h4">Collaborators</Text>
      {access.collaborators.length > 0 ? (
        <Stack gap="xs" mt="xs">
          {access.collaborators.map((member) => (
            <Group
              key={member.userId}
              justify="space-between"
              align="center"
              wrap="nowrap"
              data-testid={`access-collaborator-${member.userId}`}
            >
              <div>
                <Text size="sm">{member.name}</Text>
                <Text size="xs" c="dimmed">
                  {member.email}
                </Text>
              </div>
              {isOwner && (
                <Button
                  variant="subtle"
                  color="red"
                  size="compact-sm"
                  onClick={() => confirmRemove(member)}
                >
                  Remove
                </Button>
              )}
            </Group>
          ))}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed" mt="xs">
          No collaborators yet.
        </Text>
      )}

      {!isOwner && (
        <Group justify="flex-end" mt="lg">
          <Button variant="outline" color="red" onClick={confirmLeave}>
            Leave collection
          </Button>
        </Group>
      )}
    </Card>
  );
};

export default AccessCard;
