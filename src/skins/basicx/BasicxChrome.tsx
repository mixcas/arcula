/**
 * Basicx's fixed chrome: the top nav and the bottom footer.
 *
 * Both are `position: fixed` and overlay the sections rather than taking part in
 * the flow. The footer being fixed is not incidental: with N stacked sections a
 * footer at the end of the content would scroll away after the first artwork,
 * so it has to be pinned like the nav.
 *
 * ## The bars must not eat clicks
 *
 * A `position: fixed` bar the full viewport width would sit on top of the
 * slideshow's cursor zones and swallow every click along the top and bottom
 * strips — including on the image itself, which is top-left aligned and
 * routinely extends under both bars. So the containers are
 * `pointer-events: none` and only the links inside re-enable them. That is what
 * makes "overlay" mean overlay.
 *
 * ## The nav's empty second line
 *
 * The nav is left to its two-column row for now; the space for a second line
 * is reserved and deliberately unrendered. An empty box is indistinguishable
 * from no box, and the reserved slot is better recorded here than as markup.
 * `collection.description` is the obvious thing to put in it when it is wanted;
 * the field is written at creation and currently displayed nowhere.
 */

import React from "react";
import { Anchor, Box, Group, Stack, Text } from "@mantine/core";
import { Link } from "react-router-dom";

/**
 * The artwork the footer is describing, already resolved to display values.
 *
 * A view model rather than the `Artwork` itself, so the chrome renders three
 * fields and never learns how a URL is built. `BasicxSkin` assembles it from
 * the active artwork and `artworkPath`.
 */
export interface FooterArtwork {
  title: string;
  artistName: string;
  /** The public view of this artwork. `null` while nothing is active yet. */
  path: string | null;
}

interface BasicxChromeProps {
  collectionTitle: string;
  /** Canonical public path of the collection, for the nav title and the back link. */
  collectionPath: string;
  view: "home" | "artwork";
  /**
   * The artwork currently in view, or null before the first section reports
   * itself — which is the whole of the artwork view's steady state, since
   * there is only ever one artwork there.
   */
  artwork: FooterArtwork | null;
}

const LINK_COLOR = "rgba(0, 0, 0, 0.85)";
const DIM_COLOR = "rgba(0, 0, 0, 0.4)";

const BasicxChrome: React.FC<BasicxChromeProps> = ({
  collectionTitle,
  collectionPath,
  view,
  artwork,
}) => (
  <>
    {/*
      Nav. Two columns, gutter 1rem: the collection title on the left where the
      reference has its site title, links right-aligned where it has
      Information / Index / Email.
      Padding: 1rem at the sides, 0.9rem at the top, and 2.5rem below — the last
      one deliberately generous, so the bar clears the image beneath it.
    */}
    <Box
      component="nav"
      pos="fixed"
      top={0}
      left={0}
      w="100%"
      px="md"
      pt="0.9rem"
      pb="2.5rem"
      style={{ zIndex: 2, pointerEvents: "none" }}
    >
      <Group justify="space-between" align="flex-start" gap="md" wrap="nowrap">
        <Anchor
          component={Link}
          to={collectionPath}
          underline="never"
          size="bodycopy"
          fw={550}
          lh={1.2}
          c={LINK_COLOR}
          style={{ pointerEvents: "auto" }}
        >
          {collectionTitle}
        </Anchor>

        <Group gap="md" wrap="nowrap" style={{ pointerEvents: "auto" }}>
          {view === "artwork" ? (
            // "Index" rather than "Back": terse and gallery-familiar, and the
            // one word that names what it returns to.
            <Anchor
              component={Link}
              to={collectionPath}
              underline="never"
              size="bodycopy"
              fw={550}
              lh={1.2}
              c={LINK_COLOR}
            >
              Index
            </Anchor>
          ) : null}
          {/*
            TODO(owner link): this slot is conditional on who is looking, and
            only half of that is built.

            Intended: when the visitor is signed in AND the collection is
            theirs, show a link to the manage side here — the collection page on
            `home`, and the artwork's edit page on `artwork`, since the two
            public views are about different things. For anyone else, this
            attribution link.

            Not built: it needs `useAuth` plus a way to know the viewer owns the
            collection, and a manage-side path per view. `SkinProps` carries only
            the public paths, and adding a second pair for one conditional link
            is not a trade worth making before anything needs it. Left as this
            link rather than nothing, so the slot is not dead and the eventual
            change is a swap rather than a new element.
          */}
          <Anchor
            href="https://arcula.art"
            target="_blank"
            rel="noopener noreferrer"
            underline="never"
            size="caption"
            fw={550}
            lh={1.2}
            c={LINK_COLOR}
          >
            Powered by Arcula
          </Anchor>
        </Group>
      </Group>
    </Box>

    {/*
      Footer: the artwork in view, as two stacked lines — the title bold on top
      and the artist beneath it, dimmer because it is the quieter of the two.
      The title links to the artwork's own public view, which is what makes the
      homepage a way into its works rather than only a way past them.

      Padding is 1rem at the sides, 1.7rem above, 1rem below.
    */}
    <Box
      component="footer"
      pos="fixed"
      bottom={0}
      left={0}
      w="100%"
      px="md"
      pt="1.7rem"
      pb="md"
      style={{ zIndex: 2, pointerEvents: "none" }}
    >
      <Stack gap={0}>
        {/* A non-breaking space on each line holds its height until the first
            section reports itself, so the bar does not jump as it fills in. */}
        {artwork?.path ? (
          <Anchor
            component={Link}
            to={artwork.path}
            underline="never"
            size="bodycopy"
            fw={550}
            lh={1.2}
            c={LINK_COLOR}
          >
            {artwork.title}
          </Anchor>
        ) : (
          <Text size="bodycopy" fw={550} lh={1.2} c={LINK_COLOR}>
            {artwork?.title ?? "\u00A0"}
          </Text>
        )}
        <Text size="bodycopy" fw={450} lh={1.2} c={DIM_COLOR}>
          {artwork?.artistName ?? "\u00A0"}
        </Text>
      </Stack>
    </Box>
  </>
);

export default BasicxChrome;
