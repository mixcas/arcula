import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { db } from "@/services/firebase";
import { migrations, type Migration } from "@/migrations";
import { isMaintenanceAdmin } from "@/utils/maintenanceAccess";

type MigrationState =
  | { status: "checking" }
  | { status: "ready"; pending: number }
  | { status: "running" }
  | { status: "failed"; message: string };

/**
 * Runs the data migrations in `src/migrations` against the signed-in
 * account's own documents.
 *
 * A maintenance tool, not a user-facing screen: it exists because Firestore
 * cannot migrate data for you. When a field is added to a document type, the
 * documents written before it keep their old shape forever, and a query on the
 * new field quietly stops matching them. Rather than fixing that by hand in
 * the Firebase console, add a migration to the registry and run it here.
 *
 * Gated by `isMaintenanceAdmin`, which is a UI convenience and not a security
 * boundary — see src/utils/maintenanceAccess.ts for why that distinction is
 * safe here. The check is repeated here, not only on the card that links here,
 * because hiding a link does nothing about someone typing the URL.
 */
const MigrationsPage: React.FC = () => {
  const { currentUser } = useAuth();
  const userId = currentUser?.uid;
  const [states, setStates] = useState<Record<string, MigrationState>>({});

  const setState = (id: string, state: MigrationState) =>
    setStates((previous) => ({ ...previous, [id]: state }));

  const check = useCallback(
    async (migration: Migration) => {
      if (!userId) return;
      setState(migration.id, { status: "checking" });
      try {
        const pending = await migration.countPending(db, userId);
        setState(migration.id, { status: "ready", pending });
      } catch (error) {
        setState(migration.id, {
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [userId],
  );

  useEffect(() => {
    if (!userId) return;
    void Promise.all(migrations.map((migration) => check(migration)));
  }, [check, userId]);

  const run = async (migration: Migration) => {
    if (!userId || !isMaintenanceAdmin(currentUser?.email)) return;
    setState(migration.id, { status: "running" });
    try {
      const { updated } = await migration.run(db, userId);
      notifications.show({
        color: "green",
        title: migration.label,
        message:
          updated === 0
            ? "Nothing needed changing."
            : `Updated ${updated} document${updated === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState(migration.id, { status: "failed", message });
      notifications.show({
        color: "red",
        title: "Migration failed",
        message,
      });
      return;
    }
    // Re-read rather than trusting the count: a migration that reported
    // success but left the data unchanged should show as pending, not done.
    await check(migration);
  };

  // Anyone reaching this route without being on the allowlist gets the same
  // empty view as an unknown URL, rather than a screen that says the tool is
  // off limits — which would confirm it exists. `ProtectedRoute` has already
  // established that there is a signed-in user by the time this runs.
  if (!isMaintenanceAdmin(currentUser?.email)) {
    return <Navigate to="/manage" replace />;
  }

  return (
    <>
      <Group justify="space-between" mb="xl">
        <Text size="h2">Data migrations</Text>
      </Group>

      <Stack>
        <Text c="dimmed" maw={640}>
          Firestore has no schema, so a field added to a document type only
          exists on documents written after it. These steps bring existing
          documents up to the current shape. Each one only touches your own
          data, and re-running a step that has already run changes nothing.
        </Text>

        {migrations.map((migration) => {
          const state = states[migration.id] ?? { status: "checking" };
          return (
            <Paper key={migration.id} withBorder p="lg" maw={640}>
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap={4} style={{ flex: 1 }}>
                  <Group gap="xs">
                    <Text fw={600}>{migration.label}</Text>
                    {state.status === "ready" &&
                      (state.pending === 0 ? (
                        <Badge color="green" variant="light">
                          Up to date
                        </Badge>
                      ) : (
                        <Badge color="yellow" variant="light">
                          {state.pending} to update
                        </Badge>
                      ))}
                    {state.status === "running" && (
                      <Loader size="xs" aria-label="Running" />
                    )}
                  </Group>
                  <Text size="sm" c="dimmed">
                    {migration.description}
                  </Text>
                  {state.status === "failed" && (
                    <Alert color="red" title="Could not run">
                      {state.message}
                    </Alert>
                  )}
                </Stack>

                <Button
                  onClick={() => void run(migration)}
                  loading={state.status === "running"}
                  // Disabled while the pending count is unknown, and when
                  // there is nothing to do: running a migration blind is the
                  // one thing this screen must not do.
                  disabled={state.status !== "ready" || state.pending === 0}
                >
                  Run
                </Button>
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </>
  );
};

export default MigrationsPage;
