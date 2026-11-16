// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { Notifications, notifications } from "@mantine/notifications";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogueSlug,
  type Catalogue,
  type CatalogueAccess,
} from "@arcula/shared";

import CatalogueSettingsPage from "@/components/manage/CatalogueSettingsPage";
import { accessService } from "@/services/accessService";
import { ApiRequestError } from "@/services/api";
import { catalogueService } from "@/services/catalogueService";

/**
 * The settings page's half of the delete control on the Data tab: which caller
 * is offered it, what enables the button, and the three outcomes of confirming
 * it. The tab's own copy and Mantine's rendering are not re-tested; what this
 * file pins is the wiring the ticket names — the role read from the access
 * view, the exact-name match, one submit, and the paths after the act.
 *
 * The address is readable, so a case can tell the settings page from the
 * dashboard the success path lands on.
 */
const AddressProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="address">{location.pathname}</div>;
};

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/catalogueService", () => ({
  catalogueService: {
    getCatalogue: vi.fn(),
    updateCatalogue: vi.fn(),
    deleteCatalogue: vi.fn(),
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
const deleteCatalogue = vi.mocked(catalogueService.deleteCatalogue);
const getAccess = vi.mocked(accessService.getAccess);
/* eslint-enable @typescript-eslint/unbound-method */

const CATALOGUE_ID = "cccccccccccccccccccc";
const CATALOGUE_NAME = "Flores Solares";

const catalogue = (overrides: Partial<Catalogue> = {}): Catalogue => ({
  id: CATALOGUE_ID,
  name: CATALOGUE_NAME,
  userId: "u-owner",
  isPublic: false,
  // The dashboard row's badge: deliberately not the source the tab reads.
  role: "collaborator",
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
  ...overrides,
});

const access = (role: CatalogueAccess["role"]): CatalogueAccess => ({
  role,
  owner: {
    userId: "u-owner",
    name: "Sofía Lara",
    email: "owner@example.test",
  },
  collaborators:
    role === "owner"
      ? []
      : [
          {
            userId: "u-mate",
            name: "Mateo Ruiz",
            email: "mate@example.test",
          },
        ],
});

const renderDataTab = (
  loaded: Catalogue,
  seen: CatalogueAccess | Error | Promise<CatalogueAccess>,
) => {
  const param = catalogueSlug(loaded.name, CATALOGUE_ID);
  getCatalogue.mockResolvedValue(loaded);
  if (seen instanceof Error) {
    getAccess.mockRejectedValue(seen);
  } else if (seen instanceof Promise) {
    getAccess.mockReturnValue(seen);
  } else {
    getAccess.mockResolvedValue(seen);
  }
  return render(
    <MantineProvider>
      <Notifications />
      <MemoryRouter
        initialEntries={[`/manage/catalogue/${param}/settings/data`]}
      >
        <AddressProbe />
        <Routes>
          <Route
            path="/manage/catalogue/:catalogueId/settings/:tab?"
            element={<CatalogueSettingsPage />}
          />
          <Route path="/manage" element={<div>dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
};

const dangerCard = () => screen.findByTestId("catalogue-danger-card");

const deleteButton = () => screen.getByRole("button", { name: /delete/i });

const typeName = async (value: string) => {
  const input = await screen.findByLabelText(/catalogue name/i);
  await userEvent.clear(input);
  if (value.length > 0) {
    await userEvent.type(input, value);
  }
  return input;
};

afterEach(() => {
  cleanup();
  // The store outlives a render, so a previous case's toast would be found by
  // the next one's alert query.
  notifications.clean();
  vi.clearAllMocks();
});

describe("the settings page's delete control", () => {
  it("shows the danger card to the owner the access read names", async () => {
    // The dashboard row says collaborator; only the access read says owner.
    // The card appears because the access read decides, not the document.
    renderDataTab(catalogue({ role: "collaborator" }), access("owner"));

    const card = within(await dangerCard());
    expect(
      card.getByRole("textbox", { name: /catalogue name/i }),
    ).toBeInTheDocument();
    expect(card.getByRole("button", { name: /delete/i })).toBeDisabled();
    expect(screen.getByRole("link", { name: /import/i })).toBeInTheDocument();
  });

  it("shows a collaborator only the Import card", async () => {
    // The inverse conflict: the row says owner, the access read says not.
    renderDataTab(catalogue({ role: "owner" }), access("collaborator"));

    expect(
      await screen.findByRole("link", { name: /import/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("catalogue-danger-card")).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("offers no delete control while the access read is in flight", async () => {
    renderDataTab(catalogue(), new Promise<CatalogueAccess>(() => undefined));

    expect(
      await screen.findByRole("link", { name: /import/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("catalogue-danger-card")).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("keeps Delete disabled until the exact name is typed", async () => {
    renderDataTab(catalogue(), access("owner"));
    await dangerCard();

    const button = deleteButton();
    expect(button).toBeDisabled();

    await typeName("Flores Solar");
    expect(button).toBeDisabled();

    await typeName("flores solares");
    expect(button).toBeDisabled();

    await typeName(`  ${CATALOGUE_NAME}  `);
    expect(button).toBeEnabled();
  });

  it("submits once and shows progress while the delete is in flight", async () => {
    // A delete that never answers keeps the control in its pending state:
    // disabled, and a stray second click cannot submit the act again.
    deleteCatalogue.mockReturnValue(new Promise<void>(() => undefined));
    renderDataTab(catalogue(), access("owner"));
    await typeName(CATALOGUE_NAME);

    await userEvent.click(deleteButton());
    expect(deleteCatalogue).toHaveBeenCalledTimes(1);
    expect(deleteCatalogue).toHaveBeenCalledWith(CATALOGUE_ID);
    expect(deleteButton()).toBeDisabled();
    fireEvent.click(deleteButton());
    expect(deleteCatalogue).toHaveBeenCalledTimes(1);
  });

  it("notifies and lands on the dashboard once the delete succeeds", async () => {
    deleteCatalogue.mockResolvedValue(undefined);
    renderDataTab(catalogue(), access("owner"));
    await typeName(CATALOGUE_NAME);

    await userEvent.click(deleteButton());

    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent(/^\/manage$/),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(CATALOGUE_NAME);
  });

  it("treats a 404 as done and takes the same path", async () => {
    deleteCatalogue.mockRejectedValue(
      new ApiRequestError(404, "not-found", "Catalogue not found"),
    );
    renderDataTab(catalogue(), access("owner"));
    await typeName(CATALOGUE_NAME);

    await userEvent.click(deleteButton());

    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent(/^\/manage$/),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(CATALOGUE_NAME);
  });

  it("keeps the card, the API's message and the typed name on any other failure", async () => {
    deleteCatalogue.mockRejectedValue(
      new ApiRequestError(
        500,
        "unknown",
        "The catalogue could not be deleted.",
      ),
    );
    renderDataTab(catalogue(), access("owner"));
    const input = await typeName(CATALOGUE_NAME);

    await userEvent.click(deleteButton());

    expect(
      await screen.findByText("The catalogue could not be deleted."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("address")).toHaveTextContent(
      /\/settings\/data$/,
    );
    expect(await dangerCard()).toBeInTheDocument();
    expect(input).toHaveValue(CATALOGUE_NAME);
  });

  it("shows an alert in the card's place when the access read fails", async () => {
    renderDataTab(catalogue(), new Error("offline"));

    expect(
      await screen.findByRole("link", { name: /import/i }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});
