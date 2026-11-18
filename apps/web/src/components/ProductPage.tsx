import React from "react";
import { Text } from "@mantine/core";

/**
 * The landing page.
 *
 * The app header and the content column come from `PublicLayout`; this page
 * is its subject and nothing else. "Art Catalogue Management" is the page's
 * only top-level heading, so `/` says what it is without the wordmark doubling
 * as a heading inside a link.
 */
const ProductPage: React.FC = () => {
  return (
    <>
      <Text size="h3" component="h1">
        Art Catalogue Management
      </Text>

      <Text mt="xl">Manage and showcase your art catalogues with ease.</Text>
    </>
  );
};

export default ProductPage;
