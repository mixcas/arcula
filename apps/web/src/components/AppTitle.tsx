import React from "react";
import { Text } from "@mantine/core";

/**
 * The product wordmark, and the only place the name is written down.
 *
 * Rendered as a span, not a paragraph or a heading: each header puts it inside
 * a link, where it is incidental text in that control, and wraps it in its own
 * link to that header's home.
 */
const AppTitle: React.FC = () => (
  <Text size="lg" ff="heading" component="span">
    Arcula
  </Text>
);

export default AppTitle;
