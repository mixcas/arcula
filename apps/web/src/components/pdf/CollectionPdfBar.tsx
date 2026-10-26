/**
 * The viewer's bar: the app's header shape, branded by the Collection instead
 * of the product.
 *
 * It renders a `PdfBarView` and owns no state — `pdfBarView` decides what a
 * state says and which report the bar carries, this says where it goes: the
 * name in the wordmark's seat as the page's one top-level heading, **Collection
 * PDF** dimmed beneath it when the bar has a real name above, the name a link
 * only when there is a page to link, and on the right the work in flight or the
 * finished file with the two things that can be done with it. The work in
 * flight also runs a line along the bar's own bottom edge, so how far the
 * export has come is visible from anywhere on the page rather than read out of
 * the body. The shared `ManageLayout` frames it, so the 60 pt height is the one
 * every `/manage` page already has.
 */

import React from "react";
import {
  Anchor,
  Box,
  Button,
  Group,
  Progress,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Link } from "react-router-dom";

import PdfFileActions from "./PdfFileActions";
import type { PdfBarDetail, PdfBarView } from "./pdfBarView";

/**
 * The bar's right-hand side: the file that exists, the work in flight, or
 * nothing where the body carries the message.
 *
 * Only `preparing` offers **Cancel**, because it is the only step that can be
 * stopped without leaving a half-built document behind.
 */
const BarDetail: React.FC<{
  detail: PdfBarDetail;
  onCancel: () => void;
}> = ({ detail, onCancel }) => {
  switch (detail.kind) {
    case "none":
      return null;
    case "progress":
      return (
        <Group gap="md" wrap="nowrap">
          <Text size="sm" c="dimmed">
            {detail.label}
          </Text>
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
        </Group>
      );
    case "rendering":
      // No Cancel and no line: the renderer cannot be interrupted, and a bar
      // that does not move would be a progress report with nothing behind it.
      return (
        <Text size="sm" c="dimmed">
          {detail.label}
        </Text>
      );
    case "file":
      return (
        <Group gap="md" wrap="nowrap">
          {/* The view answers `none` for a finished file on a phone, so no
              breakpoint decides anything here: the layout already did. */}
          <Text size="sm" c="dimmed">
            {detail.summary}
          </Text>
          <PdfFileActions url={detail.url} fileName={detail.fileName} />
        </Group>
      );
  }
};

const CollectionPdfBar: React.FC<{
  view: PdfBarView;
  /** Abandons the export whose progress the bar is reporting. */
  onCancel: () => void;
}> = ({ view, onCancel }) => (
  <Box pos="relative" h="100%">
    <Group h="100%" px="md" wrap="nowrap" justify="space-between" gap="md">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Title order={1} ff="heading" size="lg" lineClamp={1}>
          {view.href ? (
            <Anchor component={Link} to={view.href} underline="never" inherit>
              {view.title}
            </Anchor>
          ) : (
            view.title
          )}
        </Title>
        {view.subtitle ? (
          <Text size="xs" c="dimmed" lineClamp={1}>
            {view.subtitle}
          </Text>
        ) : null}
      </Stack>

      <BarDetail detail={view.detail} onCancel={onCancel} />
    </Group>

    {/* The line along the bar's edge, showing the same fraction the label
        counts. A run with nothing to prepare has no line: the view answers
        `rendering` for it, which draws nothing here. It carries no name of its
        own — the label beside it says what is being counted. */}
    {view.detail.kind === "progress" ? (
      <Progress
        value={view.detail.value}
        size={4}
        radius={0}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      />
    ) : null}
  </Box>
);

export default CollectionPdfBar;
