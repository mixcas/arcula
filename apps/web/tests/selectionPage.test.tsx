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
  type Artwork,
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
    getWorks: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    addWorks: vi.fn(),
    replaceWorks: vi.fn(),
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
const getWorks = vi.mocked(selectionService.getWorks);
const updateSelection = vi.mocked(selectionService.update);
const removeSelection = vi.mocked(selectionService.remove);
const replaceWorks = vi.mocked(selectionService.replaceWorks);
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

const work = (
  id: string,
  title: string,
  status: "published" | "draft" = "published",
): Artwork => ({
  id,
  userId: "u1",
  title,
  artistName: "Ana",
  documents: [],
  photos: [],
  catalogueId: CATALOGUE_ID,
  status,
  deletedAt: null,
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
  getWorks.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  notifications.clean();
  vi.clearAllMocks();
});

describe("SelectionPage", () => {
  it("lists the selection's works in the curator's order and badges a Draft", async () => {
    getWorks.mockResolvedValue([
      work("bravo", "Bravo", "draft"),
      work("alpha", "Alpha"),
    ]);
    renderPage();

    expect(await screen.findByText("Bravo")).toBeInTheDocument();
    // The order is the content: no sorting, no paging, no catalogue order.
    expect(
      screen
        .getAllByRole("listitem")
        .map((item) => item.textContent?.match(/Alpha|Bravo/)?.[0] ?? ""),
    ).toEqual(["Bravo", "Alpha"]);
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(getWorks).toHaveBeenCalledWith(SELECTION_ID);
  });

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

  it("publishes from the visibility control, refetching before it notifies", async () => {
    updateSelection.mockResolvedValue(selection({ isPublic: true }));
    renderPage();

    expect(await screen.findByRole("radio", { name: "Private" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Public" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    // A private catalogue is not visitor-readable, so the publish asks first.
    const modal = await screen.findByRole("dialog");
    await userEvent.click(
      within(modal).getByRole("button", { name: "Publish" }),
    );

    await waitFor(() =>
      expect(updateSelection).toHaveBeenCalledWith(CATALOGUE_ID, SELECTION_ID, {
        isPublic: true,
      }),
    );
    // The same rule as every other manage write: re-read, then notify.
    expect(getSelection.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(
      await screen.findByText("Selection settings saved."),
    ).toBeInTheDocument();
  });

  it("publishes as Protected with a new password", async () => {
    // A readable catalogue means the publish is not the risk moment: this test
    // is about the password fold, not the warning.
    getCatalogue.mockResolvedValue({ ...catalogue, isPublic: true });
    updateSelection.mockResolvedValue(
      selection({ isPublic: true, isPasswordProtected: true }),
    );
    renderPage();

    await userEvent.click(
      await screen.findByRole("radio", { name: "Protected" }),
    );
    await userEvent.type(screen.getByLabelText("Password"), "open-sesame");
    await userEvent.type(
      screen.getByLabelText("Confirm password"),
      "open-sesame",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateSelection).toHaveBeenCalledWith(CATALOGUE_ID, SELECTION_ID, {
        isPublic: true,
        password: "open-sesame",
      }),
    );
  });

  it("keeps a protected Selection's password when Protected is left alone", async () => {
    getSelection.mockResolvedValue(
      selection({ isPublic: true, isPasswordProtected: true }),
    );
    renderPage();

    expect(
      await screen.findByRole("radio", { name: "Protected" }),
    ).toBeChecked();
    // No field was touched, so the Save is off — the stored password stays in
    // effect without being re-sent as a value or cleared as a removal.
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("clears the password when Protected becomes Public", async () => {
    getSelection.mockResolvedValue(
      selection({ isPublic: true, isPasswordProtected: true }),
    );
    updateSelection.mockResolvedValue(selection({ isPublic: true }));
    renderPage();

    await screen.findByRole("radio", { name: "Protected" });
    await userEvent.click(screen.getByRole("radio", { name: "Public" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateSelection).toHaveBeenCalledWith(CATALOGUE_ID, SELECTION_ID, {
        password: null,
      }),
    );
  });

  it("offers Remove password, which makes it public-unprotected", async () => {
    getSelection.mockResolvedValue(
      selection({ isPublic: true, isPasswordProtected: true }),
    );
    updateSelection.mockResolvedValue(selection({ isPublic: true }));
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Remove password" }),
    );
    expect(screen.getByRole("radio", { name: "Public" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateSelection).toHaveBeenCalledWith(CATALOGUE_ID, SELECTION_ID, {
        password: null,
      }),
    );
  });

  it("changes an existing password behind Change password", async () => {
    getSelection.mockResolvedValue(
      selection({ isPublic: true, isPasswordProtected: true }),
    );
    updateSelection.mockResolvedValue(
      selection({ isPublic: true, isPasswordProtected: true }),
    );
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Change password" }),
    );
    await userEvent.type(screen.getByLabelText("Password"), "a-new-password");
    await userEvent.type(
      screen.getByLabelText("Confirm password"),
      "a-new-password",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateSelection).toHaveBeenCalledWith(CATALOGUE_ID, SELECTION_ID, {
        password: "a-new-password",
      }),
    );
  });

  it("refuses a mismatched password without writing anything", async () => {
    renderPage();

    await userEvent.click(
      await screen.findByRole("radio", { name: "Protected" }),
    );
    await userEvent.type(screen.getByLabelText("Password"), "open-sesame");
    await userEvent.type(
      screen.getByLabelText("Confirm password"),
      "nope-nope",
    );

    expect(await screen.findByText("The passwords do not match")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(updateSelection).not.toHaveBeenCalled();
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

  it("asks before publishing when the catalogue is not visitor-readable", async () => {
    getWorks.mockResolvedValue([
      work("alpha", "Alpha", "draft"),
      work("bravo", "Bravo"),
      work("charlie", "Charlie", "draft"),
    ]);
    updateSelection.mockResolvedValue(selection({ isPublic: true }));
    renderPage();

    await userEvent.click(await screen.findByRole("radio", { name: "Public" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    const modal = await screen.findByRole("dialog");
    // The count first, then the catalogue's state — the two facts the risk is.
    expect(
      within(modal).getByText(
        /2 drafts in this selection will be readable at its address\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(modal).getByText(/“Flores Solares” is private\./),
    ).toBeInTheDocument();
    // The selection is private until the member confirms.
    expect(updateSelection).not.toHaveBeenCalled();
  });

  it("leaves the selection private when the warning is cancelled", async () => {
    renderPage();

    await userEvent.click(await screen.findByRole("radio", { name: "Public" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const modal = await screen.findByRole("dialog");
    await userEvent.click(
      within(modal).getByRole("button", { name: "Cancel" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(updateSelection).not.toHaveBeenCalled();
    // The form still holds the unsaved choice; the document is still private.
    expect(screen.getByRole("radio", { name: "Public" })).toBeChecked();
  });

  it("publishes without asking when a visitor can read the catalogue", async () => {
    getCatalogue.mockResolvedValue({ ...catalogue, isPublic: true });
    updateSelection.mockResolvedValue(selection({ isPublic: true }));
    renderPage();

    await userEvent.click(await screen.findByRole("radio", { name: "Public" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateSelection).toHaveBeenCalledWith(CATALOGUE_ID, SELECTION_ID, {
        isPublic: true,
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("carries no publish note while the selection is private", async () => {
    getWorks.mockResolvedValue([work("alpha", "Alpha", "draft")]);
    renderPage();

    await screen.findByRole("radio", { name: "Private" });
    expect(
      screen.queryByText(/This selection is public/),
    ).not.toBeInTheDocument();
  });

  it("carries no publish note when a visitor can read the catalogue", async () => {
    getCatalogue.mockResolvedValue({ ...catalogue, isPublic: true });
    getSelection.mockResolvedValue(selection({ isPublic: true }));
    getWorks.mockResolvedValue([work("alpha", "Alpha", "draft")]);
    renderPage();

    expect(await screen.findByRole("radio", { name: "Public" })).toBeChecked();
    expect(
      screen.queryByText(/This selection is public/),
    ).not.toBeInTheDocument();
  });

  it("carries the fact on every visit while a public selection's catalogue is protected", async () => {
    getCatalogue.mockResolvedValue({
      ...catalogue,
      isPublic: true,
      isPasswordProtected: true,
    });
    getSelection.mockResolvedValue(selection({ isPublic: true }));
    getWorks.mockResolvedValue([work("alpha", "Alpha", "draft")]);
    renderPage();

    expect(
      await screen.findByText(
        /This selection is public while “Flores Solares” is protected\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /It has 1 draft, which is readable at the selection's address\./,
      ),
    ).toBeInTheDocument();
  });

  it("carries the note from the moment the selection is published", async () => {
    getSelection.mockResolvedValueOnce(selection());
    // The re-read after the publish is the server's answer: public now.
    getSelection.mockResolvedValue(selection({ isPublic: true }));
    updateSelection.mockResolvedValue(selection({ isPublic: true }));
    getWorks.mockResolvedValue([work("alpha", "Alpha", "draft")]);
    renderPage();

    await userEvent.click(await screen.findByRole("radio", { name: "Public" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const modal = await screen.findByRole("dialog");
    await userEvent.click(
      within(modal).getByRole("button", { name: "Publish" }),
    );

    expect(
      await screen.findByText(
        /This selection is public while “Flores Solares” is private\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /It has 1 draft, which is readable at the selection's address\./,
      ),
    ).toBeInTheDocument();
  });

  it("recounts the drafts after curation changes the list", async () => {
    getSelection.mockResolvedValue(selection({ isPublic: true }));
    getWorks
      .mockResolvedValueOnce([
        work("alpha", "Alpha", "draft"),
        work("bravo", "Bravo"),
      ])
      .mockResolvedValue([work("bravo", "Bravo")]);
    replaceWorks.mockResolvedValue(undefined);
    renderPage();

    expect(
      await screen.findByText(
        /It has 1 draft, which is readable at the selection's address\./,
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove Alpha" }));

    await waitFor(() =>
      expect(replaceWorks).toHaveBeenCalledWith(CATALOGUE_ID, SELECTION_ID, [
        "bravo",
      ]),
    );
    expect(await screen.findByText(/It has no drafts\./)).toBeInTheDocument();
  });

  it("puts the slugged Selection address in the bar once the name is known", async () => {
    renderPage(`/manage/catalogue/${CATALOGUE_ID}/selection/${SELECTION_ID}`);

    await waitFor(() =>
      expect(screen.getByTestId("address").textContent).toBe(canonicalPath),
    );
  });
});
