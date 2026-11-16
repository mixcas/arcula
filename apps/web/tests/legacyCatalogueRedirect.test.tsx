// @vitest-environment jsdom

/**
 * The pre-rename `/collection/…` addresses, as routing: an old link is moved
 * to the catalogue address with everything after the word kept — the rest of
 * the path (a work, its PDF, a settings tab, the Deleted view), the query
 * (`q` is the artwork search suffix) and the hash — rather than 404ing on the
 * catch-all. Both families the rename touched are here: the public page and
 * the manage pages, which carry a different prefix.
 *
 * This is tier 2 by the doctrine: a redirect that drops the search still
 * renders a page, so no screenshot and no copy assertion would catch it.
 */

import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import LegacyCatalogueRedirect from "@/components/LegacyCatalogueRedirect";

afterEach(cleanup);

/** The address the router ended on, which is what the redirect produced. */
const LocationProbe: React.FC = () => {
  const { pathname, search, hash } = useLocation();
  return <div data-testid="location">{`${pathname}${search}${hash}`}</div>;
};

const renderLegacy = (entry: string, from: string, to: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path={`${from}/*`}
          element={<LegacyCatalogueRedirect from={from} to={to} />}
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

const landedOn = () => screen.getByTestId("location").textContent;

describe("the old collection addresses", () => {
  it("moves a public catalogue address, keeping its work, search and hash", () => {
    renderLegacy(
      "/collection/flores-solares-7aV9xKqL2m/artwork/estudio-en-rojo-abc123?q=rojo#detalle",
      "/collection",
      "/catalogue",
    );

    expect(landedOn()).toBe(
      "/catalogue/flores-solares-7aV9xKqL2m/artwork/estudio-en-rojo-abc123?q=rojo#detalle",
    );
  });

  it("moves a manage address, keeping the settings tab and search", () => {
    renderLegacy(
      "/manage/collection/flores-solares-7aV9xKqL2m/settings/public?q=rojo#acceso",
      "/manage/collection",
      "/manage/catalogue",
    );

    expect(landedOn()).toBe(
      "/manage/catalogue/flores-solares-7aV9xKqL2m/settings/public?q=rojo#acceso",
    );
  });
});
