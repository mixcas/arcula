import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Code,
  Divider,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";
import type { ConnectionsRead } from "@arcula/shared";
import { connectionService } from "@/services/connectionService";
import { relativeTime } from "@/utils/relativeTime";

/**
 * The account's agent access: the endpoint an MCP client is pointed at, and
 * the Connections it has made.
 *
 * The endpoint comes from the API, not from `window.location`: in development
 * the SPA is on one port and the API on another, so the browser's origin is a
 * URL that answers the app shell rather than the MCP endpoint.
 *
 * Revoke ends one Connection. It re-reads the list afterwards so the page
 * shows what the server now holds (a duplicate consent row collapses away, for
 * one); the browser session is a different credential and is untouched, so the
 * person stays signed in.
 */

/** How long "Copied" stays up: long enough to read, short enough to re-copy. */
const COPIED_FEEDBACK_MS = 2000;

const AgentAccessCard: React.FC = () => {
  const [connections, setConnections] = useState<ConnectionsRead | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeFailed, setRevokeFailed] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    connectionService
      .list()
      .then((next) => {
        if (live) setConnections(next);
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
    },
    [],
  );

  const copyEndpoint = async () => {
    if (!connections) return;
    try {
      await navigator.clipboard.writeText(connections.endpoint);
      setCopied(true);
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
      copiedTimer.current = window.setTimeout(
        () => setCopied(false),
        COPIED_FEEDBACK_MS,
      );
    } catch {
      // A browser can refuse the clipboard (no permission, no secure context).
      // The endpoint is on screen and selectable, so saying nothing copied is
      // the honest answer.
      setCopied(false);
    }
  };

  const revoke = async (connectionId: string) => {
    setRevoking(connectionId);
    setRevokeFailed(false);
    try {
      await connectionService.revoke(connectionId);
      setConnections(await connectionService.list());
    } catch {
      setRevokeFailed(true);
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Card withBorder mt="lg">
      <Text fw="600" mb="md">
        Connect an agent
      </Text>
      <Text size="sm" c="dimmed" mb="md">
        An agent you connect acts as you on your Catalogues and Artworks, with
        your own permissions. Disconnect it below at any time.
      </Text>

      {loadFailed ? (
        <Alert color="red">Could not load your connections.</Alert>
      ) : !connections ? (
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      ) : (
        <>
          <Group gap="xs" wrap="nowrap">
            <Code style={{ flex: 1, overflowWrap: "anywhere" }}>
              {connections.endpoint}
            </Code>
            <Button
              variant="light"
              size="compact-sm"
              leftSection={<IconCopy size={14} />}
              onClick={() => void copyEndpoint()}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </Group>

          <Divider my="lg" />

          <Text fw="600" mb="md">
            Connected apps
          </Text>

          {revokeFailed && (
            <Alert color="red" mb="md">
              Could not disconnect that app. Please try again.
            </Alert>
          )}

          {connections.connections.length === 0 ? (
            <Text size="sm" c="dimmed">
              No apps are connected yet.
            </Text>
          ) : (
            <Stack gap="md">
              {connections.connections.map((connection) => (
                <Group
                  key={connection.id}
                  justify="space-between"
                  align="flex-start"
                  wrap="nowrap"
                >
                  <div>
                    <Text fw={500}>{connection.clientName}</Text>
                    <Text size="sm" c="dimmed">
                      Connected {relativeTime(connection.connectedAt)} · Last
                      acted {relativeTime(connection.lastActedAt)}
                    </Text>
                  </div>
                  <Button
                    variant="outline"
                    color="red"
                    size="compact-sm"
                    loading={revoking === connection.id}
                    onClick={() => void revoke(connection.id)}
                  >
                    Revoke
                  </Button>
                </Group>
              ))}
            </Stack>
          )}
        </>
      )}
    </Card>
  );
};

export default AgentAccessCard;
