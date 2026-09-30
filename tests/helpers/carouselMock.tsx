/**
 * A stand-in for `@mantine/carousel`, for jsdom tests.
 *
 * embla measures real element rects, and jsdom reports every one as zero, so a
 * real `Carousel` initialises against nothing. What the component tests assert
 * is the *skin's* decisions — a section per artwork, the footer naming the one
 * in view, no navigation affordances for a single photo — and none of those is
 * an embla behaviour. The real component's geometry is the library's, exercised
 * by the build.
 *
 * `Carousel.extend` is part of Mantine's component contract and the skin's theme
 * calls it, so a mock without it would fail at import time on a limitation of
 * the mock rather than on anything about the skin under test.
 *
 * Beyond the original mock, the carousel is now asked to *report* where it is
 * (`getEmblaApi`, which BasicxSection uses to follow the photo in view). The
 * mock hands out a fake embla with a controllable position (`__select`), and
 * attaches that api to the carousel's DOM element so a test can pick it up as
 * `screen.getByTestId("carousel").__embla` — no registry, so an api cannot
 * leak from one test into the next.
 *
 * The api is handed out one effect pass *after* the section mounts, mirroring
 * the real carousel: `useEmblaCarousel` creates the instance in its own effect
 * and re-renders, and only then does `Carousel` call `getEmblaApi`. That
 * deferral is load-bearing — a section that subscribed to `select` from its
 * mount effect would see a null ref and never re-run, in jsdom exactly as in
 * production — so the mock replicates it rather than letting an overly eager
 * `getEmblaApi` (one called before a section's own mount effects) hide that
 * bug in tests.
 *
 * Exported as a factory because `vi.mock`'s hoisting means a shared module's
 * *bindings* are not available inside the factory — only its functions.
 */

import React, { useEffect, useRef, useState } from "react";

/** The slice of embla BasicxSection touches, plus a test-only `__select`. */
export interface MockEmblaApi {
  selectedScrollSnap: () => number;
  scrollPrev: () => void;
  scrollNext: () => void;
  on: (event: "select", callback: () => void) => void;
  off: (event: "select", callback: () => void) => void;
  /** Test hook: move to a photo index and emit `select`, as a drag would. */
  __select: (index: number) => void;
}

const createMockApi = (): MockEmblaApi => {
  let index = 0;
  const listeners = new Set<() => void>();
  const select = (next: number) => {
    index = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };
  return {
    selectedScrollSnap: () => index,
    // The skin navigates with `scrollPrev`/`scrollNext` from its click zones,
    // so the steps have to move the snap — a mock without them throws on the
    // touch the zones exist to provide. They are plain moves, not the real
    // loop: the click-zone test clicks one of each and clamps at 0.
    scrollPrev: () => select(Math.max(0, index - 1)),
    scrollNext: () => select(index + 1),
    on: (event, callback) => {
      if (event === "select") {
        listeners.add(callback);
      }
    },
    off: (event, callback) => {
      if (event === "select") {
        listeners.delete(callback);
      }
    },
    __select: select,
  };
};

export const carouselMock = () => {
  const Carousel = ({
    children,
    withControls,
    getEmblaApi,
  }: {
    children?: React.ReactNode;
    withControls?: boolean;
    getEmblaApi?: (api: MockEmblaApi) => void;
  }) => {
    const host = useRef<HTMLDivElement>(null);
    const api = useRef<MockEmblaApi | null>(null);
    if (!api.current) {
      api.current = createMockApi();
    }
    // The real carousel hands its api out only after `useEmblaCarousel` has
    // created the instance and re-rendered — one effect pass after the first
    // commit, so a section's own mount effects already ran and cannot have
    // subscribed. Mirroring that ordering makes this a faithful stand-in:
    // wait one pass, then expose the api through `getEmblaApi`.
    const [ready, setReady] = useState(false);
    useEffect(() => {
      setReady(true);
    }, []);
    useEffect(() => {
      if (!ready) return;
      getEmblaApi?.(api.current!);
      if (host.current) {
        (host.current as HTMLDivElement & { __embla?: MockEmblaApi }).__embla =
          api.current;
      }
    }, [ready, getEmblaApi]);
    return (
      <div
        ref={host}
        data-testid="carousel"
        data-with-controls={String(Boolean(withControls))}
      >
        {children}
      </div>
    );
  };
  Carousel.Slide = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  // `extend` is a property of Mantine's own component type, so assigning it
  // here is inherently outside what the declared type can express. The single
  // assertion below is the one unavoidable cast in this file, and it is why
  // this lives in a helper rather than in each test's factory.
  Object.assign(Carousel, {
    extend: (config: Record<string, unknown>): Record<string, unknown> =>
      config,
  });
  return { Carousel };
};
