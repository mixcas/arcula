import React from "react";
import { Text } from "@mantine/core";

/**
 * The product wordmark, and the only place the name is written down.
 *
 * Rendered as a span, not a paragraph: both headers put it inside a link — a
 * `<button>` — and a `<p>` is not phrasing content there. It is the wordmark,
 * not a heading; each header wraps it in its own link to that header's home.
 */
const AppTitle: React.FC = () => (
  <Text size="lg" ff="heading" component="span">
    Arcula
  </Text>
);

export default AppTitle;
