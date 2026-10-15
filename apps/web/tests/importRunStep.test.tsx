// @vitest-environment jsdom
import React, { StrictMode, act } from "react";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ImportRunStep from "@/components/manage/import/steps/ImportRunStep";
import { artworkService } from "@/services/artworkService";
import type { ReviewRow } from "@arcula/shared";

// The step's only side-effecting dependency; controlled per-test below.
vi.mock("@/services/artworkService", () => ({
  artworkService: { createArtworks: vi.fn() },
}));

// React 19 requires this flag for `act()` in non-browser test environments;
// without it every act() call logs "not configured to support act(...)".
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Referencing the mocked method is intentional — vi.mocked() returns the mock
// itself, so no `this` survives the call to need binding.
// eslint-disable-next-line @typescript-eslint/unbound-method
const createArtworksMock = vi.mocked(artworkService.createArtworks);

const row = (
  rowId: string,
  title: string,
  overrides: Partial<ReviewRow> = {},
): ReviewRow => ({
  rowId,
  acquisitionDateFrom: undefined,
  values: {
    title,
    artistName: "Whistler",
    serie: "",
    dateOfCreation: "",
    media: "",
    dimensions: "",
    editions: "",
    acquisitionDate: "",
    acquisitionPrice: "",
    placeOfOrigin: "",
    provenance: "",
    notes: "",
    condition: "",
    currentValue: "",
  },
  issues: [],
  ...overrides,
});

describe("ImportRunStep", () => {
  beforeEach(() => {
    createArtworksMock.mockReset();
    // jsdom doesn't implement matchMedia, which MantineProvider reads when
    // resolving the default color scheme during mount. Stub the minimal API.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("posts the selected rows once under StrictMode and renders the outcome", async () => {
    let resolveRun!: (outcome: {
      inserted: number;
      rejected: Array<{ row: number; errors: Record<string, string> }>;
    }) => void;
    createArtworksMock.mockImplementation(
      () => new Promise((resolve) => (resolveRun = resolve)),
    );

    render(
      <StrictMode>
        <MantineProvider>
          <MemoryRouter>
            <ImportRunStep
              rows={[row("row-0", "Nocturne"), row("row-1", "Dawn")]}
              selectedRowIds={new Set(["row-0", "row-1"])}
              collectionId="collection-1"
              collectionSlugParam="my-collection-collection-1"
              onReset={vi.fn()}
            />
          </MemoryRouter>
        </MantineProvider>
      </StrictMode>,
    );

    // StrictMode fires the effect setup twice; the ref guard must still allow
    // exactly one write.
    expect(createArtworksMock).toHaveBeenCalledTimes(1);
    // One request, one answer: the body is the posted rows' values, in the
    // selection's order.
    expect(createArtworksMock.mock.calls[0][0]).toBe("collection-1");
    expect(
      createArtworksMock.mock.calls[0][1].map(
        (values: { title: string }) => values.title,
      ),
    ).toEqual(["Nocturne", "Dawn"]);
    expect(screen.getByText(/Importing 2 artworks/)).toBeTruthy();

    act(() => {
      resolveRun({ inserted: 2, rejected: [] });
    });
    expect(await screen.findByText("2 artworks imported")).toBeTruthy();
  });

  it("points a refusal at the review row the server named", async () => {
    createArtworksMock.mockResolvedValue({
      inserted: 1,
      rejected: [{ row: 1, errors: { title: "Title is required" } }],
    });

    render(
      <MantineProvider>
        <MemoryRouter>
          <ImportRunStep
            rows={[row("row-0", "Nocturne"), row("row-1", "Dawn")]}
            selectedRowIds={new Set(["row-0", "row-1"])}
            collectionId="collection-1"
            collectionSlugParam="my-collection-collection-1"
            onReset={vi.fn()}
          />
        </MemoryRouter>
      </MantineProvider>,
    );

    // `row` is the index into the POSTED list — the second selected row — so
    // the message lands on "Dawn", not on "row 2" and not on "Nocturne".
    expect(await screen.findByText("1 imported, 1 rejected")).toBeTruthy();
    expect(screen.getByText("Dawn")).toBeTruthy();
    expect(screen.getByText(/title: Title is required/i)).toBeTruthy();
  });

  it("says the collection was left unchanged when the request itself fails", async () => {
    // No rows were written at all, so there is no per-row answer to render —
    // the outcome is a whole-request refusal.
    createArtworksMock.mockRejectedValue(new TypeError("fetch failed"));

    render(
      <MantineProvider>
        <MemoryRouter>
          <ImportRunStep
            rows={[row("row-0", "Nocturne")]}
            selectedRowIds={new Set(["row-0"])}
            collectionId="collection-1"
            collectionSlugParam="my-collection-collection-1"
            onReset={vi.fn()}
          />
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(await screen.findByText("Nothing was imported")).toBeTruthy();
    expect(
      screen.getByText("Import failed. The collection was left unchanged."),
    ).toBeTruthy();
  });
});
