// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Catalogue } from "@arcula/shared";

import GeneralTab from "@/components/manage/CatalogueSettingsGeneralTab";

/**
 * The General tab's Artwork-fields switches.
 *
 * The state update reads the switch's next value in an updater, and an
 * updater may run after the event has been dispatched — when
 * `event.currentTarget` is already null. Toggling the same control twice is
 * what makes React take that deferred path: the first update is computed
 * eagerly, the second is not. So the second click is the regression.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Mantine resolves the colour scheme through `matchMedia`, which jsdom does
// not implement. Answering the empty query only is what the other suite does.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: query === "",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

const catalogue: Catalogue = {
  id: "c1",
  name: "Studio",
  kind: "portfolio",
  userId: "u1",
  isPublic: false,
};

const renderTab = (): void => {
  render(
    <MantineProvider>
      <GeneralTab catalogue={catalogue} saving={false} onSave={vi.fn()} />
    </MantineProvider>,
  );
};

afterEach(cleanup);

describe("the General tab's Artwork fields switches", () => {
  it("toggles one field twice, reading the value before the state update", async () => {
    const user = userEvent.setup();
    renderTab();

    const provenance = screen.getByRole("switch", { name: "Provenance" });
    // A Portfolio records provenance by default.
    expect(provenance).toBeChecked();

    await user.click(provenance);
    expect(provenance).not.toBeChecked();

    // The second click is the one whose updater runs after dispatch; reading
    // `currentTarget` there throws.
    await user.click(provenance);
    expect(provenance).toBeChecked();
  });
});
