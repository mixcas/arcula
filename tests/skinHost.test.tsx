// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import SkinHost from "@/components/collection/SkinHost";
import { DEFAULT_SKIN, SKINS } from "@/skins/registry";
import type { Artwork, Collection } from "@/types";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The factory is async and imports its helper rather than closing over it:
// `vi.mock` is hoisted above the imports, so a top-level binding from this file
// would not be initialised yet when the factory runs.
vi.mock("@mantine/carousel", async () => {
  const { carouselMock } = await import("./helpers/carouselMock");
  return carouselMock();
});

const collection: Collection = {
  id: "AAAAAAAAAAAAAAAAAAAA",
  name: "Flores Solares",
  userId: "owner-1",
  isPublic: true,
};

const artwork: Artwork = {
  id: "BBBBBBBBBBBBBBBBBBBB",
  userId: "owner-1",
  collectionId: collection.id,
  title: "Estudio en rojo",
  artistName: "María López",
  isPublic: true,
  documents: [],
  photos: [],
};

const renderHost = (overrides: Partial<Parameters<typeof SkinHost>[0]> = {}) =>
  render(
    <MemoryRouter>
      <SkinHost
        view="home"
        collection={collection}
        artworks={[artwork]}
        collectionPath="/collection/flores-solares-AAAAAAAAAAAAAAAAAAAA"
        artworkPath={(work) => `/collection/x/${work.id}`}
        {...overrides}
      />
    </MemoryRouter>,
  );

beforeAll(() => {
  // `SkinHost` mounts a *nested* `MantineProvider`, and Mantine sets the colour
  // scheme on the root element through `matchMedia`. jsdom has none, so this
  // fails at mount rather than at any assertion.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query === "" || query === "(min-width: 36em)",
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SkinHost — the isolation boundary", () => {
  it("writes its CSS variables to a scoped selector, never to :root", () => {
    // The whole reason this component exists. `MantineProvider`'s
    // `cssVariablesSelector` defaults to `:root`, so a nested provider with a
    // different theme overwrites the *whole app's* `--mantine-*` variables for
    // as long as it is mounted — a skin's type scale would then apply to
    // `/manage` too. Asserted by reading the style tags the provider emitted.
    renderHost();
    const styles = [...document.querySelectorAll("style[data-mantine-styles]")]
      .map((element) => element.textContent ?? "")
      .join("\n");
    expect(styles).not.toBe("");
    // Every rule the provider emitted is scoped to the wrapper class.
    for (const rule of styles.split("}")) {
      if (rule.includes("--mantine")) {
        expect(rule).toContain(".skin-scope");
      }
    }
    expect(document.querySelector(".skin-scope")).toBeInTheDocument();
  });

  it("does not leak the skin's font family onto the document", () => {
    renderHost();
    // The app's own `:root` still governs everything outside the scope, so a
    // Basicx page cannot restyle the rest of the app by being mounted.
    const root = document.documentElement;
    const inherited = getComputedStyle(root).getPropertyValue(
      "--mantine-font-family",
    );
    expect(inherited.trim()).not.toContain("Darker Grotesque");
  });
});

describe("SkinHost — dispatch", () => {
  it("renders the collection's skin, not a hardcoded one", () => {
    renderHost();
    expect(screen.getByRole("region")).toHaveAttribute(
      "aria-label",
      "Estudio en rojo",
    );
  });

  it("resolves stored options before handing them to the skin", () => {
    // `transitionSeconds: "half a second"` is not a number, so the skin must
    // see its default rather than the stored value. The number itself is not
    // observable from the outside, so this asserts the surrounding chrome
    // rendered at all — what it pins is that a hostile value does not throw
    // before the skin is reached.
    expect(() =>
      renderHost({
        collection: {
          ...collection,
          // Wrong type: the stored value is hostile by design.
          skinOptions: { transitionSeconds: "half a second" },
        },
      }),
    ).not.toThrow();
    expect(screen.getByRole("region")).toBeInTheDocument();
  });

  it("gives the artwork view one section, from the same component", () => {
    renderHost({ view: "artwork" });
    expect(screen.getAllByRole("region")).toHaveLength(1);
  });
});

describe("the skin contract", () => {
  it("is satisfied by every registered skin without any per-skin wiring", () => {
    // A skin is added by writing a folder and adding one line to the registry.
    // This asserts the two things a new skin has to provide, so a forgotten one
    // fails here rather than on a visitor's screen.
    for (const skin of SKINS) {
      expect(typeof skin.Home, `${skin.id} needs a Home view`).toBe("function");
      expect(typeof skin.Artwork, `${skin.id} needs an Artwork view`).toBe(
        "function",
      );
      // `view` is what lets one component serve both, but a skin is allowed to
      // branch on it — so the only hard requirement is that it arrives.
      expect(skin.options.every((spec) => typeof spec.key === "string")).toBe(
        true,
      );
    }
    expect(DEFAULT_SKIN).toBeDefined();
  });
});
