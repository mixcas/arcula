// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogueSlug, type Catalogue } from "@arcula/shared";

import CatalogueSettingsPage from "@/components/manage/CatalogueSettingsPage";
import { accessService } from "@/services/accessService";
import { catalogueService } from "@/services/catalogueService";

/**
 * The address, readable: a case can assert the address means what the tab
 * shows. The probe reads the router's own state, not the tab control's
 * rendering.
 */
const AddressProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="address">{location.pathname}</div>;
};

/**
 * The settings page's half of the access card: the card fetches nothing until
 * its tab is reached, then mounts with the bare catalogue id (the route
 * carries "{slug}-{id}"), and a collaborator keeps the settings form. The
 * card's own views are pinned by `accessCard.test`; this is the wiring
 * between the page and that component.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/catalogueService", () => ({
  catalogueService: {
    getCatalogue: vi.fn(),
    updateCatalogue: vi.fn(),
  },
}));

vi.mock("@/services/accessService", () => ({
  accessService: {
    getAccess: vi.fn(),
    removeCollaborator: vi.fn(),
    leaveCatalogue: vi.fn(),
    transferCatalogue: vi.fn(),
  },
}));

vi.mock("@/services/invitationService", () => ({
  invitationService: {
    createInvitation: vi.fn(),
    resendInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
  },
}));

// Mantine resolves the colour scheme and responsive props through
// `matchMedia`, which jsdom has no implementation of. Answering `true` only
// for the empty query is what Chrome does, and it keeps responsive props
// from collapsing.
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
const getCatalogue = vi.mocked(catalogueService.getCatalogue);
const getAccess = vi.mocked(accessService.getAccess);
/* eslint-enable @typescript-eslint/unbound-method */

const CATALOGUE_ID = "cccccccccccccccccccc";

const catalogue: Catalogue = {
  id: CATALOGUE_ID,
  name: "Flores Solares",
  kind: "collection",
  userId: "u-owner",
  isPublic: false,
  role: "collaborator",
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
};

const renderPage = () => {
  const param = catalogueSlug(catalogue.name, CATALOGUE_ID);
  getCatalogue.mockResolvedValue(catalogue);
  getAccess.mockResolvedValue({
    role: "collaborator",
    owner: {
      userId: "u-owner",
      name: "Sofía Lara",
      email: "owner@example.test",
    },
    collaborators: [
      {
        userId: "u-mate",
        name: "Mateo Ruiz",
        email: "mate@example.test",
      },
    ],
  });
  return render(
    <MantineProvider>
      <MemoryRouter
        initialEntries={[`/manage/catalogue/${param}/settings/general`]}
      >
        <Routes>
          <Route
            path="/manage/catalogue/:catalogueId/settings/:tab?"
            element={
              <>
                <AddressProbe />
                <CatalogueSettingsPage />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the settings page's access card", () => {
  it("mounts the card on its tab with the parsed id, and keeps the settings form for a collaborator", async () => {
    renderPage();

    // The General panel renders first — the panel is the tab the address
    // names; a collaborator changes every setting, so the form is theirs.
    // The access read has not happened: the card lives on its own tab and
    // fetches nothing until it is reached.
    expect(await screen.findByTestId("address")).toHaveTextContent(
      /\/settings\/general$/,
    );
    expect(await screen.findByLabelText(/^name/i)).toBeInTheDocument();
    expect(getAccess).not.toHaveBeenCalled();

    // Choosing another tab changes the address as well as the panel.
    await userEvent.click(screen.getByRole("tab", { name: /access/i }));
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent(
        /\/settings\/access$/,
      ),
    );

    // The route carries the slug; the access read needs the id alone.
    await waitFor(() => expect(getAccess).toHaveBeenCalledWith(CATALOGUE_ID));
    expect(await screen.findByTestId("access-card")).toBeInTheDocument();

    // …and the card renders the collaborator's view: leave, never remove.
    expect(
      await screen.findByRole("button", { name: /leave catalogue/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
  });
});
