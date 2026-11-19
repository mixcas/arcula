// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import NewCataloguePage from "@/components/manage/catalogue/NewCataloguePage";
import { catalogueService } from "@/services/catalogueService";
import { catalogueSlug, type Catalogue } from "@arcula/shared";

/**
 * The New Catalogue page is the one place the kind is asked, and it asks it
 * with three cards. What is under test is the disclosure it drives and the
 * payload it sends:
 *
 * - with no kind chosen, no name or description field is in the document and
 *   Create is disabled;
 * - choosing a kind reveals exactly that kind's two field labels;
 * - a submit carries the chosen kind and the trimmed values, and lands on the
 *   created catalogue's URL slugged from the server's record.
 *
 * A screenshot can see the cards; it cannot see that the fields are absent
 * before a choice, that the labels follow the kind, or that the kind travels
 * in the payload.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/catalogueService", () => ({
  catalogueService: { createCatalogue: vi.fn() },
}));

// The page keeps `useAuth` for the current user and the not-authenticated
// guard; logout is no longer its business (the header's account menu owns it).
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    currentUser: {
      uid: "u1",
      email: "owner@example.test",
      emailVerified: false,
      displayName: "Owner",
    },
    logout: vi.fn(),
  }),
}));

// Mantine resolves the colour scheme and responsive props through
// `matchMedia`, which jsdom has no implementation of. Answering `true` only
// for the empty query is what Chrome does, and it keeps responsive props from
// collapsing.
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

/* eslint-disable @typescript-eslint/unbound-method */
const createCatalogue = vi.mocked(catalogueService.createCatalogue);
/* eslint-enable @typescript-eslint/unbound-method */

/** The router's own location, so the landing URL can be asserted. */
const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

const renderPage = () =>
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={["/manage/catalogue/new"]}>
        <LocationProbe />
        <Routes>
          <Route path="/manage/catalogue/new" element={<NewCataloguePage />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );

const createButton = () =>
  screen.getByRole("button", { name: "Create catalogue" });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the kind picker", () => {
  it("offers the three kinds as radios named with their persona, and no fields yet", () => {
    renderPage();

    // The card is a label around a native radio, so the rendered text is the
    // accessible name. A screen-reader user hears which kind they are choosing
    // and stores it as "Artist Portfolio", "Gallery Inventory", ...
    expect(
      screen.getByRole("radio", { name: "Artist Portfolio" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Gallery Inventory" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Art collector Collection" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);

    // Nothing is preselected: the page asks for a label only after it has said
    // what the label is for.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps Create disabled until a kind is chosen", () => {
    renderPage();

    expect(createButton()).toBeDisabled();
  });

  it("reveals the Artist's two fields on Portfolio and enables Create", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Artist Portfolio" }));

    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(
      screen.getByRole("textbox", { name: "Artist name" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Bio" })).toBeInTheDocument();
    expect(createButton()).toBeEnabled();
  });

  it("relabels the fields to the Gallery's and Collector's words", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Gallery Inventory" }));
    expect(
      screen.getByRole("textbox", { name: "Gallery name" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "About" })).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Artist name" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("radio", { name: "Art collector Collection" }),
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Description" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Gallery name" }),
    ).not.toBeInTheDocument();
  });
});

describe("creating a catalogue", () => {
  it("sends the trimmed values and the chosen kind, then lands on the server's URL", async () => {
    // The record's name differs from the typed name on purpose: the redirect
    // must slug from the server's answer, not from the form.
    const created: Catalogue = {
      id: "srv0000000",
      name: "Estudio Norte (server)",
      kind: "portfolio",
      userId: "u1",
      isPublic: false,
      role: "owner",
      createdAt: { seconds: 1, nanoseconds: 0 },
      updatedAt: { seconds: 1, nanoseconds: 0 },
    };
    createCatalogue.mockResolvedValue(created);

    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Artist Portfolio" }));
    await user.type(
      screen.getByRole("textbox", { name: "Artist name" }),
      "  Estudio Norte  ",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Bio" }),
      "  Obra reciente  ",
    );
    await user.click(createButton());

    await waitFor(() =>
      expect(createCatalogue).toHaveBeenCalledWith({
        name: "Estudio Norte",
        kind: "portfolio",
        description: "Obra reciente",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        `/manage/catalogue/${catalogueSlug(created.name, created.id)}`,
      ),
    );
  });
});
