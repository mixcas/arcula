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
 * The settings page's password wiring, on the General tab: the page actually
 * asking the pure decisions in `cataloguePassword`. The decisions themselves
 * are pinned by `cataloguePassword.test`; the behaviour only the page can get
 * wrong is the payload, so that is what this file asserts — a confirmation
 * cannot leak onto the wire, and an untouched Protected catalogue cannot
 * send a password key.
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
// for the empty query is what Chrome does.
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
const updateCatalogue = vi.mocked(catalogueService.updateCatalogue);
const getAccess = vi.mocked(accessService.getAccess);
/* eslint-enable @typescript-eslint/unbound-method */

const CATALOGUE_ID = "cccccccccccccccccccc";

const catalogue = (overrides: Partial<Catalogue> = {}): Catalogue => ({
  id: CATALOGUE_ID,
  name: "Flores Solares",
  kind: "collection",
  userId: "u-owner",
  isPublic: true,
  role: "owner",
  isPasswordProtected: false,
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
  ...overrides,
});

const renderPage = (loaded: Catalogue) => {
  const param = catalogueSlug(loaded.name, CATALOGUE_ID);
  getCatalogue.mockResolvedValue(loaded);
  updateCatalogue.mockResolvedValue(loaded);
  getAccess.mockResolvedValue({
    role: "owner",
    owner: {
      userId: "u-owner",
      name: "Sofía Lara",
      email: "owner@example.test",
    },
    collaborators: [],
    invitations: [],
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
          <Route
            path="/manage/catalogue/:catalogueId"
            element={<div>manage</div>}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
};

const save = async () => {
  await userEvent.click(await screen.findByRole("button", { name: /save/i }));
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the settings page's password control", () => {
  it("sends the password without the confirmation", async () => {
    renderPage(catalogue());

    await userEvent.type(
      await screen.findByLabelText("Password"),
      "long-enough",
    );
    await userEvent.type(
      screen.getByLabelText("Confirm password"),
      "long-enough",
    );
    await save();

    await waitFor(() => expect(updateCatalogue).toHaveBeenCalledTimes(1));
    const payload = updateCatalogue.mock.calls[0][1];
    expect(payload.password).toBe("long-enough");
    expect(payload).not.toHaveProperty("confirm");

    // No navigation on success: the member is on the tab they saved from.
    expect(screen.getByTestId("address")).toHaveTextContent(
      /\/settings\/general$/,
    );
  });

  it("sends no password key when a Protected catalogue's password is untouched", async () => {
    renderPage(catalogue({ isPasswordProtected: true }));

    // A clean tab keeps its Save off, so the rename is what offers it —
    // and the password's stored value is not what the save should carry.
    const name = await screen.findByLabelText(/^name/i);
    expect(await screen.findByRole("button", { name: /save/i })).toBeDisabled();
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed Flores");
    await save();

    await waitFor(() => expect(updateCatalogue).toHaveBeenCalledTimes(1));
    const payload = updateCatalogue.mock.calls[0][1];
    expect(payload.name).toBe("Renamed Flores");
    expect(payload).not.toHaveProperty("password");
    expect(payload).not.toHaveProperty("confirm");
  });

  it("blocks a mismatched confirmation before any request", async () => {
    renderPage(catalogue());

    await userEvent.type(
      await screen.findByLabelText("Password"),
      "long-enough",
    );
    await userEvent.type(
      screen.getByLabelText("Confirm password"),
      "different-password",
    );
    await save();

    expect(updateCatalogue).not.toHaveBeenCalled();
  });

  it("sends a null password after Remove", async () => {
    renderPage(catalogue({ isPasswordProtected: true }));

    await userEvent.click(
      await screen.findByRole("button", { name: /remove password/i }),
    );
    await save();

    await waitFor(() => expect(updateCatalogue).toHaveBeenCalledTimes(1));
    expect(updateCatalogue.mock.calls[0][1].password).toBeNull();
  });
});
