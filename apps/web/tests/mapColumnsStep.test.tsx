// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapColumnsStep from "@/components/manage/import/steps/MapColumnsStep";
import { resolveArtworkFields } from "@arcula/shared";

/**
 * The mapping step is the only place a CSV column is pointed at a record
 * field, so it is where a field the catalogue does not record has to be
 * unroutable: an option that cannot land would let a member build a mapping
 * the import then drops.
 *
 * A Portfolio is the witness because its acquisition pair starts off, while
 * every other field is on — so the same step must still offer Medium.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Mantine resolves the colour scheme through `matchMedia`, which jsdom does
// not implement. Chrome answers the empty query `true`, and so does this stub.
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

const HEADERS = ["Title", "Artist Name", "Acquisition price", "Medium"];
const enabledFields = resolveArtworkFields("portfolio", null).enabled;

let onMappingChange: ReturnType<typeof vi.fn>;

const renderStep = () =>
  render(
    <MantineProvider>
      <MapColumnsStep
        headers={HEADERS}
        sampleRows={[]}
        mapping={{}}
        onMappingChange={onMappingChange}
        enabledFields={enabledFields}
      />
    </MantineProvider>,
  );

// Mantine's Select is a readonly combobox whose option rows live in a portal,
// outside `screen`'s base element; jsdom gives them no accessible name, so
// they are read by visible text, with `hidden` because only the portal
// renders them.
const openColumn = async (
  user: ReturnType<typeof userEvent.setup>,
  column: number,
) => {
  const select = screen.getAllByRole("combobox")[column];
  await user.click(select);
  await waitFor(() => expect(select).toHaveAttribute("aria-expanded", "true"));
  return screen
    .queryAllByRole("option", { hidden: true })
    .map((option) => option.textContent ?? "");
};

describe("MapColumnsStep", () => {
  beforeEach(() => {
    onMappingChange = vi.fn();
  });

  afterEach(cleanup);

  it("does not offer a field the catalogue does not record", async () => {
    const user = userEvent.setup();
    renderStep();

    // Column 3 is the acquisition price: its field is off on this Portfolio,
    // so the Select has nothing for it to target.
    const options = await openColumn(user, 2);
    expect(options).not.toContain("Acquisition Price");
    // The enabled fields are still there, Title among them.
    expect(options).toContain("Medium");
    expect(options).toContain("Title (required)");
  });

  it("auto-maps around a column the catalogue does not record", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole("button", { name: "Auto-map columns" }));

    expect(onMappingChange).toHaveBeenCalledWith({
      0: "title",
      1: "artistName",
      3: "medium",
    });
  });
});
