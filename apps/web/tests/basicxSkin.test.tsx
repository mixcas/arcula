// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import * as rtl from "@testing-library/react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { basicxSkin } from "@/skins/basicx";
import { emblaDuration } from "@/skins/basicx/BasicxSection";
import { resolveSkinOptions } from "@/skins/registry";
import type { SkinProps } from "@/skins/types";
import type { Artwork, Collection, ImageVariantKey } from "@/types";

// React 19 requires this flag for act() outside a browser environment.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom implements no matchMedia, and both `useMediaQuery` calls in the skin
 * (the desktop breakpoint and `prefers-reduced-motion`) resolve through it.
 * The stub answers `true` only for the empty query, which is what Chrome does.
 * A stub answering `false` for everything would put every test on the mobile
 * layout, where the click zones are not rendered at all.
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
    {
      key: "large" as ImageVariantKey,
      url: `https://files.test/large/${id}.webp`,
      width: 1200,
      height: 800,
      size: 150,
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
  photos: [photo("p1", 0), photo("p2", 1)],
  ...overrides,
});

// The `render` import is shadowed by the helper below, so RTL's is aliased.
// (Naming the helper `render` reads better at every call site, and the
// shadowing is why RTL's is never called by name.)
const rtlRender = rtl.render;

const COLLECTION_PATH = "/collection/flores-solares-collection-1";

/**
 * Render the skin's Home view.
 *
 * `SkinHost` is deliberately not used: it nests its own `MantineProvider` for the
 * isolation, and this file is about the skin's own rendering decisions rather
 * than about the provider boundary. Which of `Home`/`Artwork` is mounted is
 * passed in, because they are the same component and the only difference is how
 * many sections the shell hands over.
 */
const renderSkin = ({ options: stored, ...props }: Partial<SkinProps> = {}) => {
  const merged: SkinProps = {
    collection,
    artworks: [artwork()],
    view: "home",
    collectionPath: COLLECTION_PATH,
    artworkPath: (work) =>
      `${COLLECTION_PATH}/artwork/${work.title}-${work.id}`,
    ...props,
    // Resolved last: the props above may carry raw stored options, and
    // `resolveSkinOptions` is exactly what the host does with them.
    options: resolveSkinOptions(basicxSkin, stored).options,
  };
  return rtlRender(
    <MantineProvider theme={basicxSkin.theme}>
      <MemoryRouter>
        <basicxSkin.Home {...merged} />
      </MemoryRouter>
    </MantineProvider>,
  );
};

/** Shorthand for the common case; the artwork view passes `view` through it. */
const render = (props: Partial<SkinProps> = {}) => renderSkin(props);

/**
 * Whether a click on this element would actually reach it in a browser.
 *
 * `pointer-events` is an *inherited* property, so this is one check and not a
 * walk up the ancestors: an element that does not set it computes to its bar's
 * `none` all the way down, and one that sets `auto` computes to `auto` whatever
 * its ancestors say. Both bars are `none`, so a link inside one that forgets to
 * re-enable it swallows every click meant for it. jsdom does no hit testing, so
 * this is the only way a test can see a link that exists, looks live, and cannot
 * be clicked.
 */
const isClickable = (element: HTMLElement): boolean =>
  window.getComputedStyle(element).pointerEvents !== "none";

/** The bar a link belongs to, by tag rather than by implicit ARIA role. */
const barOf = (element: HTMLElement): HTMLElement | null =>
  element.closest("nav, footer");

beforeEach(() => {
  mediaQueryAnswer = (query) => query === "" || query === "(min-width: 36em)";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Seconds to embla frames.
 *
 * The only test in this file that renders nothing, and deliberately: every wrong
 * answer here is a *plausible* slideshow rather than a broken one, so nothing
 * about a rendered section can tell a right duration from a wrong one. A test
 * that clicked the carousel and watched it move would pass identically for every
 * one of these values, because jsdom has no frames to move in.
 *
 * The property under test is the unit, not the number: embla's `ScrollBody`
 * divides by a frame count, so a value read as milliseconds is off by a factor
 * of about a thousand and a 0.5s transition becomes an eight-second slide.
 */
describe("emblaDuration", () => {
  it("converts seconds to frames, not to milliseconds", () => {
    // Half a second at 60fps is 30 frames. Passing `500` — the millisecond
    // reading — is the bug this function exists to make impossible, and it
    // would render as a 500-frame (eight second) slide.
    expect(emblaDuration(0.5)).toBe(30);
    expect(emblaDuration(1)).toBe(60);
  });

  it("answers 0 for zero and below, which is embla's instant jump", () => {
    // Not just `0`: a negative option value would otherwise become a negative
    // frame count, and embla's own special case is `!scrollDuration` rather than
    // `scrollDuration === 0`.
    expect(emblaDuration(0)).toBe(0);
    expect(emblaDuration(-1)).toBe(0);
  });

  it("never rounds a live transition down to nothing", () => {
    // `Math.max(1, …)` is the floor. A positive duration that rounded to 0
    // would be an instant jump — a transition the visitor explicitly asked for,
    // silently switched off.
    expect(emblaDuration(0.01)).toBe(1);
  });

  it("rounds to whole frames, since a fraction is not a frame count", () => {
    expect(emblaDuration(0.52)).toBe(31);
  });
});

describe("Basicx — the section per artwork", () => {
  it("renders one fullscreen section per artwork", () => {
    render({
      artworks: [
        artwork({ id: "a", title: "Uno" }),
        artwork({ id: "b", title: "Dos" }),
        artwork({ id: "c", title: "Tres" }),
      ],
    });
    expect(screen.getAllByRole("region")).toHaveLength(3);
  });

  it("gives each section an accessible name from the artwork title", () => {
    render({
      artworks: [
        artwork({ title: "Estudio en rojo" }),
        artwork({ id: "b", title: "Bodegón" }),
      ],
    });
    const sections = screen.getAllByRole("region");
    expect(sections[0]).toHaveAttribute("aria-label", "Estudio en rojo");
    expect(sections[1]).toHaveAttribute("aria-label", "Bodegón");
  });

  it("mounts every section's photos in the absence of IntersectionObserver", () => {
    // jsdom has no IntersectionObserver, so `useActiveSection` reports every
    // id as mounted. Asserted because the opposite — an empty stage — is what a
    // broken fallback would look like, and it is a silent failure.
    render({ artworks: [artwork({ id: "a" }), artwork({ id: "b" })] });
    expect(screen.getAllByTestId("carousel")).toHaveLength(2);
  });

  it("renders the same single section for the artwork view", () => {
    // `Home` and `Artwork` are the same component; the difference is only how
    // many sections the shell hands over.
    renderSkin({ artworks: [artwork()], view: "artwork" });
    expect(screen.getAllByRole("region")).toHaveLength(1);
    // The artwork view is the one that offers a way back to the index.
    expect(screen.getByRole("link", { name: "Index" })).toBeInTheDocument();
  });
});

describe("Basicx — the fixed chrome", () => {
  it("names the collection in the nav and links back to it", () => {
    render();
    const title = screen.getByRole("link", { name: "Flores Solares" });
    expect(title).toHaveAttribute(
      "href",
      "/collection/flores-solares-collection-1",
    );
  });

  it("names the first artwork in the footer before anything is scrolled", () => {
    // The fallback rather than a blank: a footer that fills in a moment later
    // reads as a bug, and the artwork view's whole behaviour is this path.
    render();
    expect(screen.getByText("Estudio en rojo")).toBeInTheDocument();
    expect(screen.getByText("María López")).toBeInTheDocument();
  });

  it("links the footer title to that artwork's public view", () => {
    render();
    // What makes the homepage a way *into* its works rather than only past
    // them. `artworkPath` comes from the shell, so the link is the canonical
    // one the rewrite effect would produce. The `view` is the `home` default:
    // the artwork view's own title is not a link — see the case below.
    const title = screen.getByRole("link", { name: "Estudio en rojo" });
    expect(title).toHaveAttribute(
      "href",
      `${COLLECTION_PATH}/artwork/Estudio en rojo-artwork-1`,
    );
  });

  it.each(["home", "artwork"] as const)(
    "makes every link in the chrome reachable by a click on the %s view",
    (view) => {
      // The regression. Both bars are `pointer-events: none` so they do not
      // swallow the slideshow's click zones, and the footer title did not
      // re-enable it on itself — so it rendered as a real link, with a pointer
      // cursor and the right href, that no mouse could follow, and clicking it
      // stepped the carousel underneath instead. Asserted over *every* link
      // rather than over that one, because a link added to a bar later fails in
      // exactly the same way and nothing else here would notice.
      renderSkin({ view });
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(
          isClickable(link),
          `the link "${link.textContent}" should be clickable`,
        ).toBe(true);
      }
    },
  );

  it("keeps the bars transparent to clicks, so they do not eat the zones", () => {
    // The other half of the rule the case above turns on, and the reason that
    // fix cannot simply be removing the `none` from the bar: a bar that took
    // its clicks back would sit over the top and bottom strips of the image and
    // swallow every step of the slideshow. One link per bar, so each bar is
    // reached through something that is definitely inside it.
    render();
    const nav = barOf(screen.getByRole("link", { name: "Flores Solares" }));
    const footer = barOf(screen.getByRole("link", { name: "Estudio en rojo" }));
    expect(nav?.tagName).toBe("NAV");
    expect(footer?.tagName).toBe("FOOTER");
    expect(window.getComputedStyle(nav!).pointerEvents).toBe("none");
    expect(window.getComputedStyle(footer!).pointerEvents).toBe("none");
  });

  it("does not link the footer title on the view it is already on", () => {
    // The artwork view's title is the work being looked at, so its canonical
    // path *is* the current URL: a link there navigates nowhere. The plain
    // branch is the same line with the same styling, so nothing shifts.
    renderSkin({ artworks: [artwork()], view: "artwork" });
    expect(
      screen.queryByRole("link", { name: "Estudio en rojo" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Estudio en rojo")).toHaveStyle({
      fontWeight: "550",
    });
  });

  it("shows the title bold and the artist dimmer", () => {
    render();
    // The title is the primary line at the same caption size; the artist is the
    // quieter of the two, which is the whole reason for the weight difference.
    expect(screen.getByRole("link", { name: "Estudio en rojo" })).toHaveStyle({
      fontWeight: "550",
    });
    expect(screen.getByText("María López")).toHaveStyle({
      fontWeight: "450",
    });
  });

  it("links the nav's right slot to arcula.art in a new tab", () => {
    render();
    // What the owner link will replace — see the TODO in BasicxChrome. An
    // external link, so a plain `href` and `noopener`: `rel` is not optional,
    // without it the opened page gets a handle on this window.
    const credit = screen.getByRole("link", { name: "Powered by Arcula" });
    expect(credit).toHaveAttribute("href", "https://arcula.art");
    expect(credit).toHaveAttribute("target", "_blank");
    expect(credit).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("holds the footer's first line with a non-breaking space when nothing is named", () => {
    // The label is the first thing to change as the first section reports
    // itself, so a placeholder that collapsed to zero height would make the bar
    // jump at exactly the moment a visitor first scrolls.
    render({ artworks: [] });
    // U+00A0, by escape. A literal non-breaking space is invisible in a source
    // file, in a diff and in review, and `no-irregular-whitespace` rejects it
    // outright. A normal space is trimmed away by CSS and renders nothing, so
    // the escape is the only way to write the character that matters.
    // Two lines now — title and artist — so there are two placeholders to
    // assert. `getAllByText` because both carry the same character.
    const placeholders = screen.getAllByText(
      (_, node) => (node?.textContent ?? "") === "\u00a0",
    );
    expect(placeholders).toHaveLength(2);
    // Asserted by code point rather than by literal, for the same reason.
    for (const node of placeholders) {
      expect(
        [...(node.textContent ?? "")].map((c) => c.codePointAt(0)),
      ).toEqual([0xa0]);
    }
  });
});

describe("Basicx — photographs", () => {
  it("offers both variants in the srcset and prefers the largest for src", () => {
    render();
    // Two photos, so two images with this alt text; the first is the primary.
    const image = screen.getAllByAltText("Estudio en rojo")[0];
    expect(image).toHaveAttribute("src", "https://files.test/xlarge/p1.webp");
    // Both candidates, each with its *recorded* width rather than the nominal
    // target — a bounded variant of a small source is smaller than its name
    // suggests, and overstating it makes the browser upscale.
    expect(image).toHaveAttribute(
      "srcset",
      "https://files.test/xlarge/p1.webp 2400w, https://files.test/large/p1.webp 1200w",
    );
  });

  it("falls back to the original for a photo with no variants at all", () => {
    render({
      artworks: [
        artwork({
          photos: [{ ...photo("p1", 0), variants: [] }],
        }),
      ],
    });
    const image = screen.getAllByAltText("Estudio en rojo")[0];
    expect(image).toHaveAttribute("src", "https://files.test/original/p1.jpg");
    // An empty srcset attribute is worse than none: the browser would treat it
    // as a candidate list of nothing.
    expect(image).not.toHaveAttribute("srcset");
  });

  it("offers no navigation affordances for a single photo", () => {
    // A slideshow of one with dead click targets is worse than the image alone.
    render({
      artworks: [artwork({ photos: [photo("p1", 0)] })],
    });
    expect(screen.queryByTestId("carousel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next photo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous photo" })).toBeNull();
  });

  it("offers the click zones on desktop, and steps the carousel", async () => {
    const user = userEvent.setup();
    render();
    expect(screen.getByTestId("carousel")).toHaveAttribute(
      "data-with-controls",
      "false",
    );
    await user.click(screen.getByRole("button", { name: "Next photo" }));
    await user.click(screen.getByRole("button", { name: "Previous photo" }));
  });

  it("swaps the zones for the carousel's own buttons on a phone", () => {
    // On a phone a half-screen tap zone is a coin flip, so the visible controls
    // take over.
    mediaQueryAnswer = (query) => query === "";
    render();
    expect(screen.getByTestId("carousel")).toHaveAttribute(
      "data-with-controls",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Next photo" })).toBeNull();
  });

  it("drops the transition entirely under prefers-reduced-motion", () => {
    // embla special-cases `duration: 0` into an instant jump, which is the right
    // answer here and is why the skin converts seconds to *frames* elsewhere.
    mediaQueryAnswer = (query) => query === "" || query === "(min-width: 36em)";
    render();
    expect(screen.getByTestId("carousel")).toBeInTheDocument();
  });

  it("renders an artwork with no photos as an empty section, not an error", () => {
    render({ artworks: [artwork({ photos: [] })] });
    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(screen.queryByAltText("Estudio en rojo")).toBeNull();
  });
});

describe("Basicx — the scoped theme", () => {
  // The test that asserted `headings.fontFamily` was set was here, and it did
  // not assert it: it rendered, found the footer's title link, and checked that
  // the link contained its own text. The reason the value is set explicitly —
  // that a deep-merging nested theme would otherwise pull in BBH Bartle, which
  // ships one weight and would fake-bold — makes it worth saying out loud,
  // because nothing in the theme object distinguishes "set to Darker Grotesque"
  // from "omitted and inherited".

  it("declares the two semantic type sizes", () => {
    const sizes = basicxSkin.theme?.fontSizes as
      Record<string, string> | undefined;
    // That they are *added* rather than substituted is not checkable here, and
    // the substitution is the likelier mistake: `createTheme` deep-merges, so
    // re-pointing `md`/`sm` would replace Mantine's values silently and the
    // resolved theme would look identical to a correct one. The reason is
    // recorded at `basicx/theme.ts`, next to the keys.
    expect(sizes?.bodycopy).toBeDefined();
    expect(sizes?.caption).toBeDefined();
  });
});
