/**
 * The viewer's bar: the app's header shape, branded by the Collection instead
 * of the product.
 *
 * It renders a `PdfBarView` and owns no state — `pdfBarView` decides what a
 * state says, this says where it goes: the name in the wordmark's seat as the
 * page's one top-level heading, **Collection PDF** dimmed beneath it when the
 * bar has a real name above, and the name a link only when there is a page to
 * link. The shared `ManageLayout` frames it, so the 60 pt height is the one
 * every `/manage` page already has.
 */

import React from "react";
import { Anchor, Group, Stack, Text, Title } from "@mantine/core";
import { Link } from "react-router-dom";

import type { PdfBarView } from "./pdfBarView";

const CollectionPdfBar: React.FC<{ view: PdfBarView }> = ({ view }) => (
  <Group h="100%" px="md" wrap="nowrap">
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
  </Group>
);

export default CollectionPdfBar;
