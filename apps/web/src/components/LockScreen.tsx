/**
 * The lock screen of a protected document: app chrome, never a skin.
 *
 * It is presentational by design. The caller owns the attempt — the service
 * call, the document it names and the reload that follows — and this component
 * owns only the prompt, the busy state and the words a refusal is reported in.
 * That is what lets a Catalogue and a Selection share one screen instead of
 * one skin each (ADR-0005, `docs/specs/selections.md`).
 *
 * The screen names the document, because the protection is over its works
 * rather than its existence: a reader who has the link is told what it is.
 *
 * On success it does not navigate, read or render the document itself — it
 * resolves, and the page re-runs the same load an ordinary visitor's page runs
 * with the grant cookie now set. One path to ready.
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

import { ApiRequestError } from "@/services/api";

/** What is locked. Decides the copy's noun, so the two gates cannot drift. */
export type LockScreenNoun = "catalogue" | "selection";

interface LockScreenProps {
  /** What is locked — the noun every sentence uses. */
  noun: LockScreenNoun;
  /** The document's name, as the refusal named it. Absent when the refusal
   *  carried no usable detail; the screen then keeps its generic line. */
  name?: string;
  /** The attempt, owned by the caller: it calls its service and rejects on a
   *  refusal. A wrong password and a spent window are reported in its terms. */
  onUnlock: (password: string) => Promise<void>;
}

/** What a refused attempt says. A wrong password is the common one; the
 *  spent window is the other worth its own sentence, and only the server can
 *  word it — it names the window and deliberately not the time left in it. */
const attemptMessage = (error: unknown, noun: LockScreenNoun): string => {
  if (error instanceof ApiRequestError && error.code === "invalid-password") {
    return `That is not the password for this ${noun}.`;
  }
  if (error instanceof ApiRequestError && error.code === "too-many-attempts") {
    return error.message;
  }
  return `Could not unlock this ${noun}. Try again.`;
};

const LockScreen: React.FC<LockScreenProps> = ({ noun, name, onUnlock }) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || password === "") return;
    setBusy(true);
    setError(null);
    try {
      await onUnlock(password);
    } catch (err) {
      setError(attemptMessage(err, noun));
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
        <Title order={2}>This {noun} is protected</Title>
        {name ? <Text fw={500}>{name}</Text> : null}
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

export default LockScreen;
