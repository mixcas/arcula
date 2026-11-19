// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { Notifications, notifications } from "@mantine/notifications";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  catalogueSlug,
  type Catalogue,
  type SelectionPageRow,
} from "@arcula/shared";

import SelectionsPage from "@/components/manage/catalogue/SelectionsPage";
import { catalogueService } from "@/services/catalogueService";
import { selectionService } from "@/services/selectionService";

/**
 * The Catalogue's Selections list, at the page seam: what a member sees on the
 * first visit, what a populated list says about each Selection, and the create
 * flow from the empty state through the refetch.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/catalogueService", () => ({
  catalogueService: { getCatalogue: vi.fn() },
}));

vi.mock("@/services/selectionService", () => ({
  selectionService: {
    list: vi.fn(),
    create: vi.fn(),
  },
}));

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
const listSelections = vi.mocked(selectionService.list);
const createSelection = vi.mocked(selectionService.create);
/* eslint-enable @typescript-eslint/unbound-method */

const CATALOGUE_ID = "cccccccccccccccccccc";
const CATALOGUE_NAME = "Flores Solares";
const CATALOGUE_SLUG = catalogueSlug(CATALOGUE_NAME, CATALOGUE_ID);

const catalogue: Catalogue = {
  id: CATALOGUE_ID,
  name: CATALOGUE_NAME,
  kind: "collection",
  userId: "u1",
  isPublic: false,
  role: "owner",
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
};

const row = (
  overrides: Partial<SelectionPageRow> & { id: string; name: string },
): SelectionPageRow => ({
  catalogueId: CATALOGUE_ID,
  isPublic: false,
  isPasswordProtected: false,
  workCount: 0,
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: {
    seconds: Math.floor((Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000),
    nanoseconds: 0,
  },
  ...overrides,
});

const AddressProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="address">{location.pathname}</div>;
};

const renderPage = (entry = `/manage/catalogue/${CATALOGUE_ID}/selections`) =>
  render(
    <MantineProvider>
      <Notifications />
      <MemoryRouter initialEntries={[entry]}>
        <AddressProbe />
        <Routes>
          <Route
            path="/manage/catalogue/:catalogueId/selections"
            element={<SelectionsPage />}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );

const dialog = async () => {
  const found = await screen.findAllByRole("dialog");
  return found[found.length - 1];
};

beforeEach(() => {
  getCatalogue.mockResolvedValue(catalogue);
  listSelections.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  notifications.clean();
  vi.clearAllMocks();
});

describe("SelectionsPage", () => {
  it("explains what a Selection is on the first visit", async () => {
    renderPage();

    expect(await screen.findByText("No selections yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Selection" }),
    ).toBeInTheDocument();
  });

  it("lists each Selection's name, visibility, work count and last change", async () => {
    listSelections.mockResolvedValue([
      row({ id: "s1", name: "Fair 2026", workCount: 3 }),
      row({ id: "s2", name: "Gallery shortlist", workCount: 1 }),
    ]);
    renderPage();

    expect(await screen.findByText("Fair 2026")).toBeInTheDocument();
    expect(screen.getByText("Gallery shortlist")).toBeInTheDocument();
    expect(screen.getByText("3 works")).toBeInTheDocument();
    expect(screen.getByText("1 work")).toBeInTheDocument();
    expect(screen.getAllByText("Private")).toHaveLength(2);
    expect(screen.getAllByText(/ago$/).length).toBe(2);
  });

  it("creates from the empty state, refetches and then notifies", async () => {
    const created = row({ id: "s3", name: "Fair 2026" });
    listSelections.mockResolvedValueOnce([]).mockResolvedValueOnce([created]);
    createSelection.mockResolvedValue(created);
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Create Selection" }),
    );
    const modal = await dialog();
    await userEvent.type(
      within(modal).getByRole("textbox", { name: /^Name/ }),
      "  Fair 2026 ",
    );
    await userEvent.type(
      within(modal).getByRole("textbox", { name: /^Description/ }),
      "  Twelve works for the fair. ",
    );
    await userEvent.click(
      within(modal).getByRole("button", { name: "Create Selection" }),
    );

    await waitFor(() =>
      expect(createSelection).toHaveBeenCalledWith(CATALOGUE_ID, {
        name: "Fair 2026",
        description: "Twelve works for the fair.",
      }),
    );
    // The list is the source of truth: the created row arrives through the
    // refetch, not through a local splice.
    expect(await screen.findByText("Fair 2026")).toBeInTheDocument();
    expect(listSelections.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText("Selection created")).toBeInTheDocument();
  });

  it("puts the Catalogue's slugged address in the bar once the name is known", async () => {
    renderPage(`/manage/catalogue/${CATALOGUE_ID}/selections`);

    await waitFor(() =>
      expect(screen.getByTestId("address").textContent).toBe(
        `/manage/catalogue/${CATALOGUE_SLUG}/selections`,
      ),
    );
  });
});
