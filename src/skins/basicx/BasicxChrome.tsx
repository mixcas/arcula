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
 * The corollary is the rule, and it is easy to break silently: **every link
 * inside a bar has to re-enable `pointer-events` itself**, because the property
 * is inherited and the bar is its ancestor. A link that does not is a real `<a>`
 * with the right `href` that no mouse can reach — the click falls through to
 * the carousel underneath, so on a multi-photo artwork it silently steps the
 * slideshow instead of navigating, and on a single-photo one it does nothing at
 * all. `pointer-events` is not the only thing that makes a link look live:
 * Mantine's `Anchor` sets `cursor: pointer` unconditionally and `underline:
 * "never"` suppresses the hover underline, so such a link is visually
 * indistinguishable from a working one. The only defence is putting
 * `pointerEvents: "auto"` on the link itself, and a test that walks the ancestor
 * chain — see `tests/basicxSkin.test.tsx`.
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
        {/*
          Linked on `home` only. On the artwork view this path is the page the
          visitor is already on, so a link there is a control that navigates
          nowhere — and the `Text` below is the same line, styled identically,
          so the two branches differ in behaviour and not in appearance.

          The `pointerEvents: "auto"` is not optional and neither is its absence
          from the nav: the footer is `none`, that inherits, and without this the
          click lands on the carousel. See the note at the top of this file.
        */}
        {artwork?.path && view === "home" ? (
          <Anchor
            component={Link}
            to={artwork.path}
            underline="never"
            size="bodycopy"
            fw={550}
            lh={1.2}
            c={LINK_COLOR}
            style={{ pointerEvents: "auto" }}
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
