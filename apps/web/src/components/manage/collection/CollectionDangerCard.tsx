/**
 * The Collection Settings Data tab's danger card: the owner's delete control.
 *
 * The role comes from the access read — the one source of the caller's role on
 * an administrative screen — never from the dashboard row's badge or from
 * comparing the collection's owner with the session. Until that read answers,
 * nothing is drawn: a card that appears and then vanishes for a collaborator
 * would offer an act the boundary never granted. A failed read keeps an alert
 * in the card's place rather than hiding the control silently.
 *
 * Confirming is the typed name: there is no dialog. A `404` is the act another
 * tab already performed, so it takes the success path; any other failure keeps
 * the card, the typed name and the API's own message.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Group,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useNavigate } from "react-router-dom";
import type { Collection, CollectionAccess } from "@arcula/shared";
import { ApiRequestError, isNotFound } from "@/services/api";
import { accessService } from "@/services/accessService";
import { collectionService } from "@/services/collectionService";

interface CollectionDangerCardProps {
  /** The loaded document's identity: the card names it and deletes it. */
  collection: Pick<Collection, "id" | "name">;
}

const CollectionDangerCard: React.FC<CollectionDangerCardProps> = ({
  collection,
}) => {
  const navigate = useNavigate();

  const [access, setAccess] = useState<CollectionAccess | null>(null);
  const [accessFailed, setAccessFailed] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The synchronous half of the double-submit guard: `deleting` is a render
  // behind the click that set it, so two clicks in one tick would both pass.
  const submitting = useRef(false);

  useEffect(() => {
    let cancelled = false;
    accessService
      .getAccess(collection.id)
      .then((row) => {
        if (!cancelled) setAccess(row);
      })
      .catch(() => {
        if (!cancelled) setAccessFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [collection.id]);

  if (accessFailed) {
    return (
      <Alert color="red" data-testid="collection-danger-card-error">
        Could not confirm your role on this collection, so deletion is not
        offered here. Reload the page to try again.
      </Alert>
    );
  }

  // Nothing until the role is known, and nothing for a collaborator: the
  // dashboard's badge is not this answer.
  if (!access || access.role !== "owner") {
    return null;
  }

  const matches = typedName.trim() === collection.name;

  const done = () => {
    notifications.show({
      color: "green",
      title: "Collection deleted",
      message: `"${collection.name}" and its artworks have left Arcula.`,
    });
    void navigate("/manage");
  };

  const confirm = async () => {
    if (submitting.current || !matches) {
      return;
    }
    submitting.current = true;
    setDeleting(true);
    setError(null);
    try {
      await collectionService.deleteCollection(collection.id);
      done();
    } catch (err) {
      // Another tab already deleted it: the act took effect, so this is the
      // same success, not a dead end.
      if (isNotFound(err)) {
        done();
      } else {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : "Could not delete the collection. Please try again.",
        );
      }
    } finally {
      submitting.current = false;
      setDeleting(false);
    }
  };

  return (
    <Card
      withBorder
      p="lg"
      data-testid="collection-danger-card"
      style={{ borderColor: "var(--mantine-color-red-6)" }}
    >
      <Stack gap="sm">
        <Text fw={600} c="red" size="lg">
          Delete this collection
        </Text>
        <Text size="sm">
          Deleting{" "}
          <Text span fw={600}>
            {collection.name}
          </Text>{" "}
          also removes its artworks and their photos and documents from Arcula,
          and the app cannot undo it.
        </Text>
        {error ? <Alert color="red">{error}</Alert> : null}
        <TextInput
          label="Collection name"
          description="Type the collection's exact name to confirm."
          value={typedName}
          onChange={(event) => setTypedName(event.currentTarget.value)}
          disabled={deleting}
        />
        <Group justify="flex-end">
          <Button
            color="red"
            disabled={!matches}
            loading={deleting}
            onClick={() => void confirm()}
          >
            Delete collection
          </Button>
        </Group>
      </Stack>
    </Card>
  );
};

export default CollectionDangerCard;
