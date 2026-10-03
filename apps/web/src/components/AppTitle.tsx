import React from "react";
import { Text, type TextProps } from "@mantine/core";

interface AppTitleProps {
  // "span" rather than Mantine's own "p" by default: ManageNavBar renders this
  // inside a <button>, and a <p> is not phrasing content, so the default would
  // emit invalid HTML. The landing page overrides it to "h1" so the page keeps
  // exactly one top-level heading.
  //
  // A union of intrinsic tags rather than React.ElementType on purpose — Mantine
  // infers Text's polymorphic type from a literal here, and a wide ElementType
  // defeats that inference.
  component?: "span" | "h1";
  size?: TextProps["size"];
}

/**
 * The product wordmark, and the only place the name is written down.
 *
 * Both headers (the landing page's PublicNavBar and the authenticated
 * ManageNavBar) render the name through this component, so a rename is a
 * one-line change here rather than a hunt through every call site. See
 * RENAME.md for the identifiers that deliberately still say "Custodia".
 */
const AppTitle: React.FC<AppTitleProps> = ({
  component = "span",
  size = "lg",
}) => (
  <Text size={size} ff="heading" component={component}>
    Arcula
  </Text>
);

export default AppTitle;
