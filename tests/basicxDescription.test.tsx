// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import * as rtl from "@testing-library/react";
import { act, cleanup, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { basicxSkin } from "@/skins/basicx";
import { resolveSkinOptions } from "@/skins/registry";
import type { SkinProps } from "@/skins/types";
import type { Artwork, Collection, ImageVariantKey } from "@/types";
import type { MockEmblaApi } from "./helpers/carouselMock";

// React 19 requires this flag for act() outside a browser environment.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom implements no matchMedia, and `useMediaQuery` in the skin resolves
 * through it. The stub answers `true` only for the empty query, which is what
 * Chrome does. The description's fade is turned off with `prefers-reduced-
 * motion` (fadeMs 0), so the *second* query matters here too — see the note in
 * `mediaQueryAnswers`.
 */
let mediaQueryAnswer = (query: string) => query === "";
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    get matches() {
      return mediaQueryAnswer(query);
    },
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

// The factory is async and imports its helper rather than closing over it:
// `vi.mock` is hoisted above the imports, so a top-level binding from this file
// would not be initialised yet when the factory runs.
vi.mock("@mantine/carousel", async () => {
  const { carouselMock } = await import("./helpers/carouselMock");
  return carouselMock();
});

// The active artwork is normally driven by IntersectionObserver, which jsdom
// does not implement. This file mocks the hook so tests can *change* which
// artwork is in view — the description's dismiss-on-scroll rule needs that.
// `farthestIndex` is the monotonic sibling of `activeId`: the real hook only
// ever grows it, so the mock mirrors that — the test sets it explicitly (and
// keeps it high when simulating a scroll back up), because that is the visible
// contract the skin derives "once hidden, never shown again" from.
const activeSectionState = {
  activeId: null as string | null,
  farthestIndex: 0,
};
vi.mock("@/skins/basicx/useActiveSection", () => ({
  useActiveSection: (_root: unknown, ids: readonly string[]) => ({
    // Mirror the no-IntersectionObserver fallback: everything is near, so the
    // carousels mount and the tests can drive their photo indices.
    register: () => () => undefined,
    activeId: activeSectionState.activeId,
    farthestIndex: activeSectionState.farthestIndex,
    mountedIds: new Set<string>(ids),
  }),
}));

const collection: Collection = {
  id: "collection-1",
  name: "Flores Solares",
  userId: "owner-1",
  isPublic: true,
};

const photo = (id: string, order: number) => ({
  id,
  order,
  name: `${id}.jpg`,
  size: 1000,
  contentType: "image/jpeg",
  width: 3000,
  height: 2000,
  original: {
    url: `https://files.test/original/${id}.jpg`,
    size: 1000,
    contentType: "image/jpeg",
  },
  variants: [
    {
      key: "xlarge" as ImageVariantKey,
      url: `https://files.test/xlarge/${id}.webp`,
      width: 2400,
      height: 1600,
      size: 400,
      contentType: "image/webp",
    },
  ],
});

const artwork = (overrides: Partial<Artwork> = {}): Artwork => ({
  id: "artwork-1",
  userId: "owner-1",
  collectionId: "collection-1",
  title: "Estudio en rojo",
  artistName: "María López",
  isPublic: true,
  documents: [],
  photos: [photo("p1", 0), photo("p2", 1), photo("p3", 2), photo("p4", 3)],
  ...overrides,
});

const rtlRender = rtl.render;

const COLLECTION_PATH = "/collection/flores-solares-collection-1";

const makeProps = ({
  options: stored,
  collection: withCollection,
  ...props
}: Partial<SkinProps> & { collection?: Collection } = {}): SkinProps => ({
  collection: { ...collection, ...withCollection },
  artworks: [artwork()],
  view: "home",
  collectionPath: COLLECTION_PATH,
  artworkPath: (work) => `${COLLECTION_PATH}/artwork/${work.title}-${work.id}`,
  ...props,
  // Resolved last: the props above may carry raw stored options, and
  // `resolveSkinOptions` is exactly what the host does with them.
  options: resolveSkinOptions(basicxSkin, stored).options,
});

const renderSkin = ({
  ...props
}: Partial<SkinProps> & { collection?: Collection } = {}) =>
  rtlRender(
    <MantineProvider theme={basicxSkin.theme}>
      <MemoryRouter>
        <basicxSkin.Home {...makeProps(props)} />
      </MemoryRouter>
    </MantineProvider>,
  );

/** The fake embla apis of the rendered carousels, in document order. */
const carouselApis = (): MockEmblaApi[] =>
  screen
    .getAllByTestId("carousel")
    .map(
      (el) =>
        (el as HTMLElement & { __embla?: MockEmblaApi })
          .__embla as MockEmblaApi,
    );

/** The wrapped description element, or null when the collection has none. */
const descriptionBox = (): HTMLElement | null => {
  const text = screen.queryByText("A handful of sunscapes.");
  return text?.parentElement ?? null;
};

const moveTo = (api: MockEmblaApi, index: number) =>
  act(() => {
    api.__select(index);
  });

beforeEach(() => {
  mediaQueryAnswer = (query) => query === "" || query === "(min-width: 36em)";
  activeSectionState.activeId = null;
  activeSectionState.farthestIndex = 0;
});

afterEach(() => {
  cleanup();
});

describe("Basicx — the collection description", () => {
  it("renders the description bottom-right on home when the collection has one", () => {
    renderSkin({ collection: { description: "A handful of sunscapes." } });
    const box = descriptionBox();
    expect(box).not.toBeNull();
    expect(box).toHaveStyle({ opacity: "1", visibility: "visible" });
    expect(box).toHaveAttribute("aria-hidden", "false");
  });

  it("keeps the artwork lines and the description in the same footer", () => {
    renderSkin({ collection: { description: "A handful of sunscapes." } });
    const box = descriptionBox();
    const footer = box?.closest("footer");
    expect(footer).not.toBeNull();
    // The footer bar stays transparent to clicks even with the description in
    // it — the description is text, not a target, and must not eat the
    // slideshow zones either.
    expect(window.getComputedStyle(footer!).pointerEvents).toBe("none");
  });

  it("renders nothing when the description is blank or whitespace", () => {
    renderSkin({ collection: { description: "   \n  " } });
    expect(screen.queryByText(/sunscapes/)).toBeNull();
  });

  it("keeps the description out of the artwork view, not merely faded over it", () => {
    // It is an introduction to the collection, and a visitor on one artwork
    // has already stepped past the introduction. The chrome mounts the box
    // (so the fade it would play never measures a fresh element), which means
    // "hidden" rather than "absent" is what "not shown" asserts: invisible to
    // the eye, to the screen reader, and to any pointer.
    rtlRender(
      <MantineProvider theme={basicxSkin.theme}>
        <MemoryRouter>
          <basicxSkin.Artwork
            {...makeProps({
              collection: { description: "A handful of sunscapes." },
              view: "artwork" as const,
            })}
          />
        </MemoryRouter>
      </MantineProvider>,
    );
    const box = descriptionBox();
    expect(box).not.toBeNull();
    expect(box).toHaveStyle({ opacity: "0", visibility: "hidden" });
    expect(box).toHaveAttribute("aria-hidden", "true");
  });

  it("fades out when the visitor clicks to the second photo of the first artwork", () => {
    renderSkin({
      collection: { description: "A handful of sunscapes." },
      artworks: [artwork()],
    });
    const [api] = carouselApis();
    expect(api.selectedScrollSnap()).toBe(0);
    expect(descriptionBox()).toHaveStyle({ opacity: "1" });

    // The first photo is the moment the description accompanies; the next
    // photo is the visitor stepping past it.
    moveTo(api, 1);
    const box = descriptionBox();
    expect(box).toHaveStyle({ opacity: "0", visibility: "hidden" });
    expect(box).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the description on a single-photo artwork, which can never step to a next photo", () => {
    // A single photo renders no carousel at all (`BasicxSection` shows the
    // image on its own), so no photo index is ever reported and the photo
    // clause can never fire — hiding the description here would mean it never
    // appears at all. Only the scroll can dismiss it.
    renderSkin({
      collection: { description: "A handful of sunscapes." },
      artworks: [artwork({ photos: [photo("p1", 0)] })],
    });
    expect(screen.queryAllByTestId("carousel")).toHaveLength(0);
    expect(descriptionBox()).toHaveStyle({ opacity: "1" });
  });

  it("stays hidden after being dismissed, even when scrolled back", () => {
    // The latch: the description is an introduction, and a visitor who has
    // already passed it does not get it back by scrolling up.
    renderSkin({
      collection: { description: "A handful of sunscapes." },
      artworks: [artwork({ id: "work-a" }), artwork({ id: "work-b" })],
    });
    moveTo(carouselApis()[0], 1);
    expect(descriptionBox()).toHaveStyle({ opacity: "0" });

    // Back to the first photo — gone for good.
    moveTo(carouselApis()[0], 0);
    expect(descriptionBox()).toHaveStyle({ opacity: "0" });
  });

  it("dismisses when the visitor scrolls to the second artwork, for good", () => {
    const merged = makeProps({
      collection: { description: "A handful of sunscapes." },
      artworks: [artwork({ id: "work-a" }), artwork({ id: "work-b" })],
    });
    const result = rtlRender(
      <MantineProvider theme={basicxSkin.theme}>
        <MemoryRouter>
          <basicxSkin.Home {...merged} />
        </MemoryRouter>
      </MantineProvider>,
    );
    expect(descriptionBox()).toHaveStyle({ opacity: "1" });

    // Scroll down to the second artwork.
    activeSectionState.activeId = "work-b";
    activeSectionState.farthestIndex = 1;
    result.rerender(
      <MantineProvider theme={basicxSkin.theme}>
        <MemoryRouter>
          <basicxSkin.Home {...merged} />
        </MemoryRouter>
      </MantineProvider>,
    );
    expect(descriptionBox()).toHaveStyle({ opacity: "0" });

    // Scroll back up to the first artwork: `activeId` follows the scroll,
    // but `farthestIndex` does not, so the description stays dismissed. This
    // is the artwork half of the monotonic rule the photo case already
    // exercised.
    activeSectionState.activeId = "work-a";
    result.rerender(
      <MantineProvider theme={basicxSkin.theme}>
        <MemoryRouter>
          <basicxSkin.Home {...merged} />
        </MemoryRouter>
      </MantineProvider>,
    );
    expect(descriptionBox()).toHaveStyle({ opacity: "0" });
  });
});
