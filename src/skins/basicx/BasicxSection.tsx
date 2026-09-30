/**
 * One fullscreen section: one artwork, its photos, and the way through them.
 *
 * A slideshow of one artwork's photos, filling the viewport. The skin stacks one
 * of these per artwork — which is why the chrome lives in `BasicxChrome` rather
 * than here, and why the fixed footer needs `useActiveSection` to know whose
 * title to show.
 *
 * ## Why `Carousel` and not a hand-rolled slideshow
 *
 * `@mantine/carousel` is embla under the hood, and embla supplies drag physics,
 * `loop`, per-instance arrow-key handling and the focus management that comes
 * with a real carousel — all of which would otherwise be hand-written here.
 *
 * The sizing model works out exactly, which is the part worth spelling out
 * because it does not look like it should. `Carousel.Slide` is
 * `flex: 0 0 var(--carousel-slide-size, 100%)` — a plain block, with no
 * `display: flex` and no `align-items` on it. So an `Image` sized
 * `w="auto" h="auto" maw="100%" mah="100dvh"` keeps its intrinsic aspect ratio,
 * shrinks to fit both caps, and sits at the top-left of the slide by ordinary
 * block layout. So the image is shown at its natural size, capped to fit the
 * viewport in both axes, anchored top-left — with no `object-fit` and no
 * alignment override.
 *
 * ## Two deliberate departures
 *
 * - `slideGap` is `0`. With `includeGapInSize` on (Mantine's default) a gap
 *   would make `maw="100%"` mean "the viewport minus a rem", so a full-bleed
 *   image would stop just short of the right edge.
 * - The slide *slides* rather than crossfading. `embla-carousel` as installed
 *   ships no plugins at all — the package's only export is `EmblaCarousel` plus
 *   types — so `Carousel`'s `plugins` prop cannot be given embla's `Fade`.
 *   Reproducing a crossfade would mean dropping `Carousel` and hand-rolling on
 *   core `Transition`, losing everything in the paragraph above for one effect.
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Box, Image, UnstyledButton } from "@mantine/core";
import { Carousel } from "@mantine/carousel";
import type { EmblaCarouselType } from "embla-carousel";

import { photoSrcSet, photoUrl, sortPhotos } from "@/utils/artworkPhotos";
import type { Artwork, ArtworkPhoto } from "@/types";

/**
 * The chevron shown over each click zone.
 *
 * Drawn to match the `Control` buttons it sits alongside — same white at 0.9
 * alpha, same 1.5px stroke — so the affordance and the fallback look like one
 * piece of design rather than two. `w-resize`/`e-resize` is the fallback for a
 * browser that rejects an SVG cursor.
 */
const chevronCursor = (direction: "left" | "right"): string => {
  const path = direction === "left" ? "M15 5L8 12l7 7" : "M9 5l7 7-7 7";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" ` +
    `viewBox="0 0 24 24" fill="none" stroke="black" stroke-opacity="0.6" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${path}"/></svg>`;
  const fallback = direction === "left" ? "w-resize" : "e-resize";
  // `12 12` is the hotspot: the tip of the chevron, not its top-left corner.
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, ${fallback}`;
};

/**
 * Convert a transition length in seconds to embla's `duration`.
 *
 * The name is a trap. Embla's `duration` is **not** milliseconds — its
 * `ScrollBody` does `scrollVelocity += displacement / scrollDuration` once per
 * animation frame, so the value is a frame count and the default of 25 is
 * roughly 0.4s at 60fps. Passing `500` for "half a second" would give an
 * eight-second slide.
 *
 * `0` is special-cased by embla (`isInstant = !scrollDuration`) and jumps
 * straight to the target, which is what both `transitionSeconds: 0` and
 * `prefers-reduced-motion` want.
 */
const emblaDuration = (seconds: number): number =>
  seconds <= 0 ? 0 : Math.max(1, Math.round(seconds * 60));

/**
 * One photo, sized to the spec: natural size, capped to fit the viewport.
 *
 * `src` is the `xlarge` variant with `photoUrl`'s fallback to the original, so
 * a photo uploaded before `xlarge` existed still renders. `srcSet` offers only
 * the variants this photo actually has, which is what makes that fallback
 * unnecessary in practice: a legacy photo offers `large` and the browser picks
 * it, a current one offers `xlarge` too.
 *
 * `loading="lazy"` costs the first section nothing — a lazy image already in
 * the viewport loads immediately, and only the sections below the fold defer.
 */
const SlideImage: React.FC<{ photo: ArtworkPhoto; alt: string }> = ({
  photo,
  alt,
}) => (
  <Image
    src={photoUrl(photo, "xlarge") ?? undefined}
    srcSet={photoSrcSet(photo, ["xlarge", "large"])}
    sizes="100vw"
    alt={alt}
    // Mantine's `fit` defaults to `cover`, which would crop. The box is already
    // the image's own aspect ratio, so this is belt-and-braces rather than
    // load-bearing — but a default that crops is not one to leave implicit.
    fit="contain"
    w="auto"
    h="auto"
    maw="100%"
    mah="100dvh"
    loading="lazy"
    decoding="async"
  />
);

interface BasicxSectionProps {
  artwork: Artwork;
  /** Stable ref callback from `useActiveSection`. */
  sectionRef: (element: HTMLElement | null) => void;
  /**
   * Whether to mount the photos at all. False until the section has been within
   * a viewport of the stage, so a fifty-artwork collection does not create
   * fifty embla instances and five hundred `<img>` elements up front.
   */
  mounted: boolean;
  /** Desktop gets click zones; a phone gets the carousel's own round buttons. */
  desktop: boolean;
  transitionSeconds: number;
  reduceMotion: boolean;
  /**
   * Reports the index of the photo in view within this section's carousel, so
   * the skin can dismiss content that accompanies only the first photo. A
   * section with one photo or not yet mounted reports nothing and reads as 0.
   *
   * The artwork id is part of the signature because the skin keys its photo
   * record by it — which also makes the callback itself stable, so the
   * subscription below can capture it without a "latest value" ref.
   */
  onPhotoIndexChange?: (artworkId: string, index: number) => void;
}

const BasicxSection: React.FC<BasicxSectionProps> = ({
  artwork,
  sectionRef,
  mounted,
  desktop,
  transitionSeconds,
  reduceMotion,
  onPhotoIndexChange,
}) => {
  const embla = useRef<EmblaCarouselType | null>(null);
  const photos = sortPhotos(artwork.photos);
  const navigable = photos.length > 1;

  // Only report a change, so the parent's record does not get written on
  // every `select` with a value it already has.
  const lastReported = useRef(0);

  // The embla instance does not exist when this section's effects first run:
  // `useEmblaCarousel` creates it inside its *own* effect and re-renders the
  // carousel, and only on that later pass does `Carousel` call `getEmblaApi`.
  // So the `select` subscription is attached there, not from an effect that
  // would see a null ref and never re-run. `Carousel` re-invokes the callback
  // whenever its own select bookkeeping re-runs, so subscribing is idempotent:
  // the previous listener is torn down before a fresh one is added. The
  // unmount-only effect below releases whatever is current; `api.off` is a
  // plain store filter, safe even against a destroyed api.
  const unsubscribe = useRef<(() => void) | null>(null);

  useEffect(() => () => unsubscribe.current?.(), []);

  const attachEmbla = useCallback(
    (api: EmblaCarouselType) => {
      embla.current = api;
      unsubscribe.current?.();
      const sync = () => {
        const index = api.selectedScrollSnap();
        if (index !== lastReported.current) {
          lastReported.current = index;
          onPhotoIndexChange?.(artwork.id, index);
        }
      };
      sync();
      api.on("select", sync);
      unsubscribe.current = () => api.off("select", sync);
    },
    [artwork.id, onPhotoIndexChange],
  );

  // Memoized: Mantine re-initialises embla when the options object's identity
  // changes, and a fresh literal every render would reset the visitor to the
  // first photo on any parent re-render.
  const emblaOptions = useMemo(
    () => ({
      axis: "x" as const,
      loop: navigable,
      duration: reduceMotion ? 0 : emblaDuration(transitionSeconds),
    }),
    [navigable, reduceMotion, transitionSeconds],
  );

  return (
    <Box
      component="section"
      ref={sectionRef}
      mih="100dvh"
      pos="relative"
      style={{ scrollSnapAlign: "start" }}
      aria-label={artwork.title}
    >
      {!mounted || photos.length === 0 ? null : navigable ? (
        <Carousel
          height="100dvh"
          slideSize="100%"
          slideGap={0}
          withIndicators={false}
          // On a phone a half-screen tap zone is a coin flip, so the visible
          // round controls take over and the zones are not rendered at all.
          withControls={!desktop}
          withKeyboardEvents
          getEmblaApi={attachEmbla}
          emblaOptions={emblaOptions}
        >
          {photos.map((photo) => (
            <Carousel.Slide key={photo.id}>
              <SlideImage photo={photo} alt={artwork.title} />
            </Carousel.Slide>
          ))}
        </Carousel>
      ) : (
        // One photo: no carousel, no zones, no loop. A slideshow of one with
        // dead click targets is worse than the image on its own.
        <SlideImage photo={photos[0]} alt={artwork.title} />
      )}

      {/*
        Real buttons rather than `aria-hidden` divs with the controls elsewhere.
        The first instinct was to hide these and lean on the carousel's own
        `Control`s for keyboard and screen-reader access — but on desktop those
        are switched off, so the zones would have been the only way through and
        unreachable by anything but a mouse. They cover the image, which also
        blocks dragging and text selection on it; the cursor is the affordance
        that says so.
      */}
      {mounted && desktop && navigable ? (
        <>
          <UnstyledButton
            aria-label="Previous photo"
            onClick={() => embla.current?.scrollPrev()}
            pos="absolute"
            top={0}
            bottom={0}
            left={0}
            w="50%"
            style={{ cursor: chevronCursor("left"), zIndex: 1 }}
          />
          <UnstyledButton
            aria-label="Next photo"
            onClick={() => embla.current?.scrollNext()}
            pos="absolute"
            top={0}
            bottom={0}
            right={0}
            w="50%"
            style={{ cursor: chevronCursor("right"), zIndex: 1 }}
          />
        </>
      ) : null}
    </Box>
  );
};

export default BasicxSection;
