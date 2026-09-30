/**
 * What a public page shows when it has nothing to show.
 *
 * Deliberately outside the skin, and deliberately plain Mantine in the *app*
 * theme. These states are not the collection's presentation — they are the
 * absence of one, and a visitor who hit "This collection is private." has not
 * reached anything a skin should be styling. It also means a broken or empty
 * collection renders without depending on a skin that may itself be the thing
 * that is wrong.
 */

import React from "react";
import { Alert, Container, Group, Loader, Text } from "@mantine/core";

import type { PublicStatus } from "./usePublicCollection";

/** The statuses that are not `ready` — what this component can be given. */
export type UnreadyStatus = Exclude<PublicStatus, "ready">;

/** The statuses that get a sentence rather than a spinner. */
type MessagedStatus = Exclude<UnreadyStatus, "loading">;

const DEFAULT_LABELS: Record<MessagedStatus, string> = {
  invalid: "That collection link is not valid.",
  error: "Failed to load this collection. Please try again.",
  private: "This collection is private.",
  notFound: "This collection is not available.",
};

interface PublicStateMessageProps {
  status: UnreadyStatus;
  /**
   * Replaces the wording for the states that read differently on the two
   * views — the artwork view's "private" and "notFound" are about an artwork,
   * not a collection.
   */
  labels?: Partial<Record<MessagedStatus, string>>;
}

const PublicStateMessage: React.FC<PublicStateMessageProps> = ({
  status,
  labels,
}) => {
  if (status === "loading") {
    return (
      <Container size="xl" py="2rem">
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      </Container>
    );
  }

  const label = labels?.[status] ?? DEFAULT_LABELS[status];

  return (
    <Container size="xl" py="2rem">
      {status === "error" ? (
        <Alert color="red" title="Something went wrong">
          {label}
        </Alert>
      ) : (
        <Text>{label}</Text>
      )}
    </Container>
  );
};

export default PublicStateMessage;
