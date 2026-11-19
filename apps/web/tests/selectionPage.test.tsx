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
import { ModalsProvider } from "@mantine/modals";
import { Notifications, notifications } from "@mantine/notifications";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  catalogueSlug,
  selectionSlug,
  type Catalogue,
  type Selection,
} from "@arcula/shared";

import SelectionPage from "@/components/manage/catalogue/SelectionPage";
import { catalogueService } from "@/services/catalogueService";
import { selectionService } from "@/services/selectionService";

/**
 * One Selection's manage page at the seam this slice owns: the settings block
 * writes only what changed, every save refetches before it notifies, and the
 * delete confirmation names what it leaves alone.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/catalogueService", () => ({
  catalogueService: { getCatalogue: vi.fn() },
}));

vi.mock("@/services/selectionService", () => ({
  selectionService: {
    get: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
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
const getSelection = vi.mocked(selectionService.get);
const updateSelection = vi.mocked(selectionService.update);
const removeSelection = vi.mocked(selectionService.remove);
/* eslint-enable @typescript-eslint/unbound-method */

const CATALOGUE_ID = "cccccccccccccccccccc";
const CATALOGUE_NAME = "Flores Solares";
const SELECTION_ID = "ssssssssssssssssssss";
const SELECTION_NAME = "Fair 2026";
const CATALOGUE_SLUG = catalogueSlug(CATALOGUE_NAME, CATALOGUE_ID);
const SELECTION_SLUG = selectionSlug(SELECTION_NAME, SELECTION_ID);

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

const selection = (overrides: Partial<Selection> = {}): Selection => ({
  id: SELECTION_ID,
  catalogueId: CATALOGUE_ID,
  name: SELECTION_NAME,
  description: "Twelve works for the fair.",
  isPublic: false,
  isPasswordProtected: false,
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
  ...overrides,
});

const AddressProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="address">{location.pathname}</div>;
};

const canonicalPath = `/manage/catalogue/${CATALOGUE_SLUG}/selection/${SELECTION_SLUG}`;

const renderPage = (entry = canonicalPath) =>
  render(
    <MantineProvider>
      <ModalsProvider>
        <Notifications />
        <MemoryRouter initialEntries={[entry]}>
          <AddressProbe />
          <Routes>
            <Route
              path="/manage/catalogue/:catalogueId/selection/:selectionId"
              element={<SelectionPage />}
            />
            <Route
              path="/manage/catalogue/:catalogueId/selections"
              element={<div>selections list</div>}
            />
          </Routes>
        </MemoryRouter>
      </ModalsProvider>
    </MantineProvider>,
  );

beforeEach(() => {
  getCatalogue.mockResolvedValue(catalogue);
  getSelection.mockResolvedValue(selection());
});

afterEach(() => {
  cleanup();
  notifications.clean();
  vi.clearAllMocks();
});

describe("SelectionPage", () => {
  it("saves only the changed fields, refetches, then notifies", async () => {
    updateSelection.mockResolvedValue(
      selection({ name: "Fair selection", description: "A shortlist." }),
    );
    renderPage();

    const name = await screen.findByRole("textbox", { name: /^Name/ });
    await userEvent.clear(name);
    await userEvent.type(name, "  Fair selection  ");
    const description = screen.getByRole("textbox", { name: /^Description/ });
    await userEvent.clear(description);
    await userEvent.type(description, "  A shortlist.  ");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateSelection).toHaveBeenCalledWith(CATALOGUE_ID, SELECTION_ID, {
        name: "Fair selection",
        description: "A shortlist.",
      }),
    );
    // The page re-reads the document rather than trusting a local copy.
    expect(getSelection.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(
      await screen.findByText("Selection settings saved."),
    ).toBeInTheDocument();
  });

  it("clears the description with null rather than an empty string", async () => {
    updateSelection.mockResolvedValue(selection({ description: undefined }));
    renderPage();

    const description = await screen.findByRole("textbox", {
      name: /^Description/,
    });
    await userEvent.clear(description);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateSelection).toHaveBeenCalledWith(CATALOGUE_ID, SELECTION_ID, {
        description: null,
      }),
    );
  });

  it("deletes behind a confirmation that names what it leaves untouched", async () => {
    removeSelection.mockResolvedValue(undefined);
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Delete" }),
    );
    const modal = await screen.findByRole("dialog");
    expect(
      within(modal).getByText(
        /works, their photos and the Catalogue are untouched/i,
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(modal).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() =>
      expect(removeSelection).toHaveBeenCalledWith(CATALOGUE_ID, SELECTION_ID),
    );
    await waitFor(() =>
      expect(screen.getByTestId("address").textContent).toBe(
        `/manage/catalogue/${CATALOGUE_SLUG}/selections`,
      ),
    );
    expect(await screen.findByText(/was removed/)).toBeInTheDocument();
  });

  it("puts the slugged Selection address in the bar once the name is known", async () => {
    renderPage(`/manage/catalogue/${CATALOGUE_ID}/selection/${SELECTION_ID}`);

    await waitFor(() =>
      expect(screen.getByTestId("address").textContent).toBe(canonicalPath),
    );
  });
});
