/**
 * The lock screen of a Protected collection: app chrome, never a skin.
 *
 * It lives beside the canonical-URL rewrite in the public pages rather than in
 * a skin, for two reasons: the set of skins is open-ended, and a skin would
 * otherwise have to implement the same prompt; and the lock is about the
 * collection, not about how the collection is presented (ADR-0005). It also
 * lives outside the skin's scope on purpose — a skin may not use a portaled
 * Mantine component, and a prompt is exactly that.
 *
 * The screen names the collection, because the protection is over its works
 * rather than its existence: a reader who has the link is told what it is.
 *
 * On success it does not navigate, read or render the collection itself — it
 * calls `onUnlocked`, and the page re-runs the same load an ordinary visitor's
 * page runs with the grant cookie now set. One path to ready.
 */

import React, { useState } from "react";
import {
  Alert,
  Button,
  Container,
  Group,
  PasswordInput,
  Stack,
  Text,
  Title,
} from "@mantine/core";

import { collectionService } from "@/services/collectionService";
import { ApiRequestError } from "@/services/api";

interface CollectionLockScreenProps {
  /** The collection being unlocked: what the unlock call names. */
  collectionId: string;
  /** The collection's name, as the refusal named it. Absent when the refusal
   *  carried no usable detail; the screen then keeps its generic line. */
  collectionName?: string;
  /** Run the ordinary load again — the page's `reload`. */
  onUnlocked: () => void;
}

/** What a refused attempt says. A wrong password is the only one worth a
 *  different sentence: everything else is the connection, not the secret. */
const attemptMessage = (error: unknown): string =>
  error instanceof ApiRequestError && error.code === "invalid-password"
    ? "That is not the password for this collection."
    : "Could not unlock this collection. Please try again.";

const CollectionLockScreen: React.FC<CollectionLockScreenProps> = ({
  collectionId,
  collectionName,
  onUnlocked,
}) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || password === "") return;
    setBusy(true);
    setError(null);
    try {
      await collectionService.unlockCollection(collectionId, password);
      onUnlocked();
    } catch (err) {
      setError(attemptMessage(err));
    } finally {
      // A reload that lands back on the lock screen — a cookie the browser
      // refuses to keep, a password rewritten between the attempt and the
      // read — must not leave the button spinning with nothing behind it.
      setBusy(false);
    }
  };

  return (
    <Container size="xs" py="4rem">
      <Stack>
        <Title order={2}>This collection is protected</Title>
        {collectionName ? <Text fw={500}>{collectionName}</Text> : null}
        <Text c="dimmed">Enter its password to view the works.</Text>
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <Stack>
            <PasswordInput
              label="Password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              autoComplete="current-password"
              autoFocus
            />
            {error ? <Alert color="red">{error}</Alert> : null}
            <Group justify="flex-end">
              <Button type="submit" loading={busy} disabled={password === ""}>
                Unlock
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Container>
  );
};

export default CollectionLockScreen;
