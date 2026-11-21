// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SelectionPdfPage from "@/components/pdf/SelectionPdfPage";
import { CataloguePdfAccessError } from "@/components/pdf/cataloguePdfAccess";
import { ApiRequestError } from "@/services/api";
import {
  selectionSlug,
  type Artwork,
  type SelectionPublicRead,
} from "@arcula/shared";

/**
 * The Selection PDF viewer at the seam this slice owns: Selection first, works
 * second; one plan; the export named after the Selection; and a mid-export
 * access loss surfacing the same state a fresh visit would.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

Object.assign(URL, {
  createObjectURL: vi.fn(() => "blob:selection-pdf"),
  revokeObjectURL: vi.fn(),
});

const getPublicSelection = vi.fn<() => Promise<SelectionPublicRead | null>>();
const getWorks = vi.fn<() => Promise<Artwork[]>>();
const unlockSelection = vi.fn<() => Promise<void>>();
const exportSelection = vi.fn();

vi.mock("@/services/selectionService", () => ({
  selectionService: {
    getPublicSelection: (...args: unknown[]) =>
      (getPublicSelection as unknown as (...a: unknown[]) => unknown)(...args),
    getWorks: (...args: unknown[]) =>
      (getWorks as unknown as (...a: unknown[]) => unknown)(...args),
    unlockSelection: (...args: unknown[]) =>
      (unlockSelection as unknown as (...a: unknown[]) => unknown)(...args),
  },
}));

vi.mock("@/components/pdf/selectionPdfExport", () => ({
  exportSelection: (...args: unknown[]) =>
    (exportSelection as unknown as (...a: unknown[]) => unknown)(...args),
}));

const SELECTION_ID = "SSSSSSSSSSSSSSSSSSSS";
const SELECTION_NAME = "Winter shortlist";
const SLUG = selectionSlug(SELECTION_NAME, SELECTION_ID);

const selectionRead = (
  overrides: Partial<SelectionPublicRead> = {},
): SelectionPublicRead => ({
  selection: {
    id: SELECTION_ID,
    name: SELECTION_NAME,
    isPublic: true,
  },
  catalogueName: "Flores Solares",
  kind: "collection",
  ...overrides,
});

const work = (
  id: string,
  status: "draft" | "published" = "published",
): Artwork => ({
  id,
  userId: "UUUUUUUUUUUUUUUUUUUU",
  catalogueId: "CCCCCCCCCCCCCCCCCCCC",
  title: id,
  artistName: "Ana",
  status,
  photos: [],
  documents: [],
});

const AddressProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="address">{location.pathname}</div>;
};

const renderPage = (entry = `/selection/${SELECTION_ID}/pdf`) =>
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={[entry]}>
        <AddressProbe />
        <Routes>
          <Route
            path="/selection/:selectionId/pdf"
            element={<SelectionPdfPage />}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );

beforeEach(() => {
  getPublicSelection.mockReset();
  getWorks.mockReset();
  unlockSelection.mockReset();
  exportSelection.mockReset();
  getPublicSelection.mockResolvedValue(selectionRead());
  getWorks.mockResolvedValue([work("alpha"), work("bravo", "draft")]);
  exportSelection.mockResolvedValue({
    blob: new Blob(["pdf"]),
    pages: 1,
  });
});

afterEach(cleanup);

describe("SelectionPdfPage", () => {
  it("reads the Selection first, exports one plan, and names the file after it", async () => {
    renderPage();

    const frame = await screen.findByTitle("Selection PDF", undefined, {
      timeout: 5000,
    });
    expect(frame).toBeInTheDocument();

    // The lock only exists on the Selection read, so it necessarily comes
    // before the works.
    expect(getPublicSelection.mock.invocationCallOrder[0]).toBeLessThan(
      getWorks.mock.invocationCallOrder[0],
    );
    // One plan, the works as read: Drafts kept and the curator's order intact.
    expect(exportSelection).toHaveBeenCalledTimes(1);
    const [read, works] = exportSelection.mock.calls[0] as [
      SelectionPublicRead,
      Artwork[],
    ];
    expect(read.selection.id).toBe(SELECTION_ID);
    expect(works.map((entry) => entry.id)).toEqual(["alpha", "bravo"]);

    const download = await screen.findByRole("link", { name: /Download/ });
    expect(download.getAttribute("download")).toBe("winter-shortlist.pdf");
    const back = screen.getByRole("link", { name: SELECTION_NAME });
    expect(back.getAttribute("href")).toBe(`/selection/${SLUG}`);
  });

  it("canonicalises the address in place once the Selection is readable", async () => {
    renderPage(`/selection/${SELECTION_ID}/pdf`);

    await waitFor(() =>
      expect(screen.getByTestId("address").textContent).toBe(
        `/selection/${SLUG}/pdf`,
      ),
    );
  });

  it("says so when the Selection has no works", async () => {
    getWorks.mockResolvedValue([]);
    renderPage();

    expect(
      await screen.findByText("This selection has no works."),
    ).toBeInTheDocument();
  });

  it("challenges a protected Selection and reloads the export after unlock", async () => {
    getPublicSelection.mockRejectedValueOnce(
      new ApiRequestError(403, "password-required", "Locked", undefined, {
        selectionName: SELECTION_NAME,
      }),
    );
    unlockSelection.mockResolvedValue(undefined);
    renderPage();

    expect(
      await screen.findByRole("heading", {
        name: "This selection is protected",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(SELECTION_NAME).length).toBeGreaterThan(0);
    // Nothing behind the challenge was read.
    expect(getWorks).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Password"), "open-sesame");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() =>
      expect(unlockSelection).toHaveBeenCalledWith(SELECTION_ID, "open-sesame"),
    );
    expect(await screen.findByTitle("Selection PDF")).toBeInTheDocument();
  });

  it.each([
    [
      "private",
      new CataloguePdfAccessError({ status: "private" }),
      "This selection is private.",
    ],
    [
      "locked",
      new CataloguePdfAccessError({
        status: "locked",
        selectionName: SELECTION_NAME,
      }),
      "This selection is protected",
    ],
    [
      "not found",
      new CataloguePdfAccessError({ status: "notFound" }),
      "This selection is not available.",
    ],
  ])(
    "surfaces the %s state when the Selection stops being readable mid-export",
    async (_case, refusal, message) => {
      exportSelection.mockRejectedValue(refusal);
      renderPage();

      if (refusal.state.status === "locked") {
        expect(
          await screen.findByRole("heading", { name: message }),
        ).toBeInTheDocument();
        return;
      }
      expect(await screen.findByText(message)).toBeInTheDocument();
    },
  );
});
