/**
 * Which fullscreen section the visitor is looking at, and which are near enough
 * to be worth mounting.
 *
 * Basicx stacks one `100dvh` section per artwork inside a single scroller, with
 * the chrome `position: fixed` over the top of all of them. Two things follow:
 *
 * - The fixed footer names the *current* artwork, so it has to follow the
 *   scroll. `activeId` is that.
 * - Rendering every artwork's carousel up front would mean one embla instance
 *   and a pile of `<img>` elements per photo, for a collection that may have
 *   fifty artworks. `nearIds` gates mounting to the sections within a viewport
 *   of the stage.
 *
 * Both come from `IntersectionObserver` rather than a scroll handler: a scroll
 * listener that measures every section on every frame is exactly the work the
 * observer does off the main thread, and it would need the same `root` anyway.
 *
 * ## `farthestIndex` is `activeId`'s one-way sibling
 *
 * The footer names the artwork in view, so `activeId` must follow the scroll
 * back up as well as down. One-way presentations — the collection description
 * is gone for the visit once the visitor passes the first artwork — instead
 * derive from `farthestIndex`, which only ever grows: the observer sets it
 * when a section becomes active, comparing document position *there* rather
 * than in render, so the monotonic rule is expressed as data rather than as a
 * latch the skin would have to keep.
 *
 * ## The root is the stage, not the viewport
 *
 * `.stage` is its own scroller (`overflow-y: auto`) so that no global CSS is
 * needed — putting `scroll-snap-type` on `html` would apply it to `/manage`
 * too, which is the one thing the scoped theme exists to prevent. Because the
 * stage scrolls and the document does not, the default root would never fire.
 * Every observer here is created with `root: stage`.
 *
 * ## Why `ids` is an argument
 *
 * The caller already knows the artworks, and knowing them at *render* time is
 * what lets the no-`IntersectionObserver` fallback work without a `setState`
 * inside the effect — which the react-hooks rules flag, correctly, because it
 * would cascade an extra render on mount. A ref populated by the ref callbacks
 * would be empty on the first render, and a section that is not "near" does not
 * mount, so the fallback would never take effect at all in jsdom.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export interface ActiveSection {
  /**
   * A stable ref callback for one section.
   *
   * Stable *per id*, which matters: a fresh closure every render would make
   * React detach and reattach the ref on every render, unobserving and
   * re-observing the element each time.
   */
  register: (id: string) => (element: HTMLElement | null) => void;
  /** The section crossing the centre of the stage. `null` until one does. */
  activeId: string | null;
  /**
   * The index in `ids` of the farthest section the visitor has reached.
   *
   * Monotonic on purpose, and the deliberate contrast with `activeId`, which
   * follows the scroll back up — the skin's footer must name the artwork in
   * view again after a scroll up. One-way presentations (the collection
   * description never re-appearing once dismissed) are derived from this
   * instead: a monotonic input makes the one-way latch a plain value.
   */
  farthestIndex: number;
  /**
   * Sections whose content should be mounted.
   *
   * Grows and never shrinks. Removing a section when it scrolls away would
   * unmount its carousel, and remounting it would hand the visitor back the
   * first photo every time they scrolled back to a work they had already been
   * through.
   */
  mountedIds: ReadonlySet<string>;
}

export const useActiveSection = (
  root: RefObject<HTMLElement | null>,
  ids: readonly string[],
): ActiveSection => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [nearIds, setNearIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  // The farthest section ever made active, and why it is a second state rather
  // than `activeId`: the footer names whatever is currently in view, so `activeId`
  // must follow the scroll in both directions, while the description's "once
  // dismissed, gone for the visit" needs the *farthest* position, which only
  // ever grows. The observer callback is the one place either may be set — it
  // runs outside render, so the monotonic update below is how the one-way rule
  // is expressed without a latch.
  const [farthestId, setFarthestId] = useState<string | null>(null);

  // Both directions of the element <-> id mapping. The reverse one exists so a
  // detach is O(1) instead of a scan over every registered section.
  const idOf = useRef(new Map<HTMLElement, string>());
  const elementOf = useRef(new Map<string, HTMLElement>());
  const callbacks = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const observers = useRef<IntersectionObserver[]>([]);

  // Accumulated in a ref rather than read back from state, because the observer
  // callback is created once and would otherwise close over the first render's
  // value. The ref is only ever written from inside that callback, at the same
  // moment the state is set, so the two cannot drift — and where a discarded
  // render leaves the ref ahead of the state, the extra ids are ones that were
  // legitimately near, which is the safe direction to be wrong in.
  const nearIdsRef = useRef<Set<string>>(new Set<string>());

  const observe = useCallback((element: HTMLElement) => {
    for (const observer of observers.current) {
      observer.observe(element);
    }
  }, []);

  const unobserve = useCallback((element: HTMLElement) => {
    for (const observer of observers.current) {
      observer.unobserve(element);
    }
  }, []);

  // The centre observer compares document positions of sections, so it needs
  // `ids` when it fires. `ids` is a fresh array each render, and a ref updated
  // here — in an effect, the sanctioned place to touch refs — is how the
  // callback sees the latest order without being recreated on every render.
  const idsRef = useRef<readonly string[]>([]);
  useEffect(() => {
    idsRef.current = ids;
  }, [ids]);

  useEffect(() => {
    const stage = root.current;
    if (!stage || typeof IntersectionObserver === "undefined") {
      return;
    }

    // A zero-height band across the middle of the stage. At most one section
    // can be inside it, so whichever enters is the active one — no arithmetic
    // about which of several partially-visible sections counts.
    const centre = new IntersectionObserver(
      (entries) => {
        const entering = entries.filter((entry) => entry.isIntersecting);
        if (entering.length === 0) {
          return;
        }
        // A fast scroll can report two sections entering in one callback. The
        // later one in document order is where the visitor actually ended up.
        const last = entering[entering.length - 1];
        const id = last && idOf.current.get(last.target as HTMLElement);
        if (id !== undefined) {
          setActiveId(id);
          // The farthest section only ever moves forward. Comparing document
          // positions here — rather than below, in render — is what keeps the
          // monotonic rule out of the rendered output, where the react-hooks
          // rules would rightly object to a state write.
          setFarthestId((previous) => {
            const previousIndex =
              previous === null ? -1 : idsRef.current.indexOf(previous);
            return idsRef.current.indexOf(id) > previousIndex ? id : previous;
          });
        }
      },
      { root: stage, rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );

    const nearby = new IntersectionObserver(
      (entries) => {
        const next = new Set(nearIdsRef.current);
        let changed = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const id = idOf.current.get(entry.target as HTMLElement);
          if (id !== undefined && !next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
        if (changed) {
          nearIdsRef.current = next;
          setNearIds(next);
        }
      },
      { root: stage, rootMargin: "100% 0px 100% 0px", threshold: 0 },
    );

    observers.current = [centre, nearby];
    // Sections attach their refs during commit, before this effect runs, so
    // everything already on screen is picked up here and anything mounted later
    // is picked up by `register`.
    for (const element of elementOf.current.values()) {
      observe(element);
    }

    return () => {
      observers.current = [];
      centre.disconnect();
      nearby.disconnect();
    };
  }, [root, observe]);

  const register = useCallback(
    (id: string) => {
      let callback = callbacks.current.get(id);
      if (!callback) {
        callback = (element: HTMLElement | null) => {
          const previous = elementOf.current.get(id);
          if (previous && previous !== element) {
            unobserve(previous);
            idOf.current.delete(previous);
          }
          if (element) {
            idOf.current.set(element, id);
            elementOf.current.set(id, element);
            observe(element);
          } else {
            elementOf.current.delete(id);
          }
        };
        callbacks.current.set(id, callback);
      }
      return callback;
    },
    [observe, unobserve],
  );

  // jsdom implements no IntersectionObserver, so nothing would ever report a
  // section as near and every section would stay empty. A browser without one
  // would also rather show the whole collection than wait for an event that
  // cannot fire, so this is the right failure mode and not only a test
  // affordance.
  //
  // `ids` rather than the registered elements: on the first render no ref has
  // been attached yet, so a ref-derived set would be empty — and an empty
  // `mountedIds` means no carousel renders, which means the sections would
  // never register either. The caller only passes ids it is rendering anyway.
  const mountedIds =
    typeof IntersectionObserver === "undefined"
      ? new Set<string>(ids)
      : nearIds;

  // Same fallback as `activeId` below: without IntersectionObserver nothing
  // ever reports a section as reached, so the honest answer for a degraded
  // browser is that the visitor never passed the first artwork. `Math.max`
  // guards the (impossible) stale-id case: an id that left `ids` reads as -1.
  const farthestIndex =
    farthestId === null ? 0 : Math.max(0, ids.indexOf(farthestId));

  return {
    register,
    activeId: activeId ?? ids[0] ?? null,
    farthestIndex,
    mountedIds,
  };
};
