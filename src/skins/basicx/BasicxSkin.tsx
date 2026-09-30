/**
 * Basicx: one implementation, two entry points.
 *
 * A full-bleed slideshow: one `100dvh` section per artwork, each showing that
 * work's photos, with a fixed nav and a fixed footer pinned over the whole
 * scroll. The look (type scale, padding, control styling, image sizing) is a
 * written spec rather than a set of defaults, and every number in it is a named
 * constant — in `theme.ts` and `BasicxChrome.tsx` — so revising it is a diff
 * against those constants.
 *
 * `Home` and `Artwork` are the same component. They differ only in how many
 * sections there are: the shell hands the artwork view a one-element array, so
 * "the whole collection" and "this one work" are the same code path rather than
 * two that have to be kept in step. That is what makes a skin able to show
 * *more* on the artwork view later without the homepage drifting.
 *
 * ## The stage is its own scroller
 *
 * `.stage` owns `overflow-y: auto` and the scroll snapping rather than letting
 * the document scroll. That is not a preference: `scroll-snap-type` on `html`
 * would apply to `/manage` as well, which is precisely what the scoped theme
 * exists to prevent. With the stage as the scroller the document never scrolls
 * and no global CSS is needed at all.
 *
 * The consequence to remember: the stage is the observer `root`, so anything
 * measuring scroll position — `useActiveSection` — has to be given the stage
 * ref, not left on the default viewport root.
 */

import React, { useRef } from "react";
import { Box } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

import BasicxChrome, { type FooterArtwork } from "./BasicxChrome";
import BasicxSection from "./BasicxSection";
import { basicxOptions } from "./options";
import { useActiveSection } from "./useActiveSection";
import type { SkinProps } from "@/skins/types";

/**
 * Where the skin switches from click zones to buttons.
 *
 * Mantine's `sm` (36em), the same threshold the rest of the app uses implicitly
 * through its responsive props. The initial value is `true` so the
 * first paint is the desktop layout and a phone does not flash the round
 * controls and then swap them for tap zones.
 */
const DESKTOP_QUERY = "(min-width: 36em)";

const BasicxSkin: React.FC<SkinProps> = ({
  collection,
  artworks,
  view,
  options,
  collectionPath,
  artworkPath,
}) => {
  const { transitionSeconds } = basicxOptions(options);
  const stage = useRef<HTMLDivElement>(null);
  const desktop = useMediaQuery(DESKTOP_QUERY, true);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  const ids = artworks.map((artwork) => artwork.id);
  const { register, activeId, mountedIds } = useActiveSection(stage, ids);

  // The footer names whatever is in view, so it has to follow the scroll on the
  // homepage. The fallback to the first artwork is what makes the footer
  // correct immediately — and is the whole of the artwork view's behaviour,
  // where there is only ever one.
  const active = artworks.find((artwork) => artwork.id === activeId) ?? null;

  // Resolved here rather than in the chrome so the chrome never learns how a
  // path is built. `artworkPath` is the shell's, so a skin cannot invent a URL
  // that the canonical rewrite would disagree with.
  const footerArtwork: FooterArtwork | null = active
    ? {
        title: active.title,
        artistName: active.artistName,
        path: artworkPath(active),
      }
    : null;

  return (
    <Box pos="relative" mih="100dvh">
      <BasicxChrome
        collectionTitle={collection.name}
        collectionPath={collectionPath}
        view={view}
        artwork={footerArtwork}
      />

      {/*
        Focusable so the scroll is reachable from the keyboard, and labelled
        because a scrollable region is a landmark a screen-reader user needs to
        be able to skip past. `PageUp`/`PageDown` and the arrow keys then work
        natively. Arrow keys are deliberately *not* wired to the photos here:
        embla already handles them per carousel when focus is inside it, which
        is the scoping that matters with a dozen carousels on one page.
      */}
      <Box
        ref={stage}
        component="main"
        h="100dvh"
        tabIndex={0}
        aria-label="Collection"
        style={{
          overflowY: "auto",
          overflowX: "hidden",
          // `proximity` and never `mandatory`: mandatory snapping fights the
          // fixed chrome on a viewport shorter than the chrome plus its target
          // section, and traps a visitor mid-scroll on a short artwork.
          scrollSnapType: reduceMotion ? "none" : "y proximity",
        }}
      >
        {artworks.map((artwork) => (
          <BasicxSection
            key={artwork.id}
            artwork={artwork}
            sectionRef={register(artwork.id)}
            mounted={mountedIds.has(artwork.id)}
            desktop={desktop}
            transitionSeconds={transitionSeconds}
            reduceMotion={reduceMotion}
          />
        ))}
      </Box>
    </Box>
  );
};

export default BasicxSkin;
