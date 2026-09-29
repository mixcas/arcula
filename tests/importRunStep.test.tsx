// @vitest-environment jsdom
import React, { StrictMode, act } from "react";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ImportRunStep from "@/components/manage/import/steps/ImportRunStep";
import { artworkService } from "@/services/artworkService";
import type { ReviewRow } from "@/schemas/artworkImport";

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

const row = (rowId: string, overrides: Partial<ReviewRow> = {}): ReviewRow => ({
  rowId,
  acquisitionDateFrom: undefined,
  values: {
    title: "Nocturne",
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

  it("runs once and keeps reporting progress and the result under StrictMode", async () => {
    let resolveRun!: (outcome: { created: number; failed: number }) => void;
    // Two rows tick like two committed batches. The onProgress callbacks fire
    // asynchronously — after real Firestore round trips, which is after
    // StrictMode's effect cleanup has already run. That timing is exactly what
    // regressed: a cleanup that cancelled the in-flight run silenced every
    // update, leaving the step stuck on "Importing 2 artworks…" forever even
    // though the writes succeeded.
    createArtworksMock.mockImplementation(
      (_payloads, onProgress) =>
        new Promise((resolve) => {
          resolveRun = resolve;
          setTimeout(() => onProgress?.(1), 10);
          setTimeout(() => onProgress?.(2), 30);
        }),
    );

    render(
      <StrictMode>
        <MantineProvider>
          <MemoryRouter>
            <ImportRunStep
              rows={[row("row-0"), row("row-1")]}
              selectedRowIds={new Set(["row-0", "row-1"])}
              collectionId="collection-1"
              userId="user-1"
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
    expect(screen.getByText(/Importing 2 artworks/)).toBeTruthy();

    // The async progress tick reaches the UI (the regression left the bar
    // stuck at "0 of 2 committed…").
    expect(await screen.findByText(/1 of 2 committed/)).toBeTruthy();

    // Completion renders once the batch resolves.
    act(() => {
      resolveRun({ created: 2, failed: 0 });
    });
    expect(await screen.findByText(/2 artworks imported/)).toBeTruthy();
  });
});
