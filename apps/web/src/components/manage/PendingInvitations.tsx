/**
 * The pending offers addressed to the signed-in account, on the dashboard.
 *
 * This is the invitee's list, not the owner's administrative view: the server
 * returns only the caller's own live offers, each with the collection and the
 * account that sent it. A card offers decline alone — acceptance needs the
 * token in the mail, which is the proof of inbox control (ADR-0004) — and says
 * so, because an email that never arrived is otherwise a dead end.
 *
 * A decline that lands removes the card. A `404` means the offer lapsed or was
 * revoked between the read and the click: it is no longer an offer, so it
 * leaves the card too, without an error the reader cannot act on.
 */

import React, { useEffect, useState } from "react";
import { Alert, Button, Card, Group, Stack, Text } from "@mantine/core";
import type { InvitationInboxEntry } from "@arcula/shared";
import { isNotFound } from "@/services/api";
import { invitationService } from "@/services/invitationService";

const PendingInvitations: React.FC = () => {
  const [invitations, setInvitations] = useState<InvitationInboxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [declining, setDeclining] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    invitationService
      .getPendingInvitations()
      .then((rows) => {
        if (!cancelled) setInvitations(rows);
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
  }, []);

  const remove = (id: string) =>
    setInvitations((current) => current.filter((row) => row.id !== id));

  const handleDecline = async (id: string) => {
    setDeclining(id);
    setActionError(null);
    try {
      const declined = await invitationService.declinePendingInvitation(id);
      if (declined.status !== "declined") {
        setActionError("Could not decline the invitation. Please try again.");
        return;
      }
      remove(id);
    } catch (err) {
      if (isNotFound(err)) {
        // Expired or revoked since the list loaded: it is already no offer.
        remove(id);
        return;
      }
      setActionError("Could not decline the invitation. Please try again.");
    } finally {
      setDeclining(null);
    }
  };

  // Nothing to say while the read is in flight, and nothing to show when the
  // account has no offers.
  if (loading) return null;
  if (loadFailed) {
    return (
      <Alert color="red" mb="xl" data-testid="pending-invitations-error">
        Could not load your invitations.
      </Alert>
    );
  }
  if (invitations.length === 0) return null;

  return (
    <Stack gap="sm" mb="xl" data-testid="pending-invitations">
      <Text size="h2">Pending invitations</Text>

      {actionError && (
        <Alert color="red" data-testid="pending-invitations-action-error">
          {actionError}
        </Alert>
      )}

      {invitations.map((invitation) => (
        <Card
          key={invitation.id}
          shadow="sm"
          p="lg"
          data-testid={`pending-invitation-${invitation.id}`}
        >
          <Group justify="space-between" align="center" wrap="nowrap">
            <div>
              <Text size="h3">{invitation.collectionName}</Text>
              <Text size="sm" c="dim">
                Invited by {invitation.inviterName}
              </Text>
              <Text size="sm" mt="xs">
                Acceptance happens through the link in the email sent to{" "}
                {invitation.email}.
              </Text>
            </div>
            <Button
              variant="subtle"
              color="red"
              onClick={() => void handleDecline(invitation.id)}
              loading={declining === invitation.id}
              disabled={declining !== null}
            >
              Decline
            </Button>
          </Group>
        </Card>
      ))}
    </Stack>
  );
};

export default PendingInvitations;
