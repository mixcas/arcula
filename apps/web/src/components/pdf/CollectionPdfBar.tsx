/**
 * The viewer's bar: the app's header shape, branded by the Collection instead
 * of the product.
 *
 * It renders a `PdfBarView` and owns no state — `pdfBarView` decides what a
 * state says and whether the file is shown at all, this says where it goes: the
 * name in the wordmark's seat as the page's one top-level heading, **Collection
 * PDF** dimmed beneath it when the bar has a real name above, the name a link
 * only when there is a page to link, and the finished file's summary beside the
 * two things that can be done with it. The shared `ManageLayout` frames it, so
 * the 60 pt height is the one every `/manage` page already has.
 */

import React from "react";
import { Anchor, Group, Stack, Text, Title } from "@mantine/core";
import { Link } from "react-router-dom";

import PdfFileActions from "./PdfFileActions";
import type { PdfBarView } from "./pdfBarView";

const CollectionPdfBar: React.FC<{ view: PdfBarView }> = ({ view }) => (
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

    {view.detail.kind === "file" ? (
      <Group gap="md" wrap="nowrap">
        {/* The view leaves the detail empty on a phone, so no breakpoint
            decides anything here: the layout already did. */}
        <Text size="sm" c="dimmed">
          {view.detail.summary}
        </Text>
        <PdfFileActions url={view.detail.url} fileName={view.detail.fileName} />
      </Group>
    ) : null}
  </Group>
);

export default CollectionPdfBar;
