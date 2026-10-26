import { describe, expect, it } from "vitest";

import { pdfBarView } from "@/components/pdf/pdfBarView";
import type { PublicState } from "@/components/collection/usePublicCollection";
import type { Collection } from "@arcula/shared";

const collection = (overrides: Partial<Collection> = {}): Collection => ({
  id: "collection-1",
  name: "Flores Solares",
  userId: "owner-1",
  isPublic: true,
  ...overrides,
});

type BarState = PublicState<{ collection: Collection }>;

/**
 * The bar's naming rules, one per state: the Collection's name wherever a read
 * disclosed it, the fallback title where none did, a link only to a page that
 * exists, and the subtitle only beside a real name (issue #146).
 */
describe("pdfBarView", () => {
  it("names the Collection and links its page when the read succeeded", () => {
    const ready: BarState = {
      status: "ready",
      value: { collection: collection() },
    };

    expect(pdfBarView(ready)).toEqual({
      title: "Flores Solares",
      subtitle: "Collection PDF",
      href: "/collection/flores-solares-collection-1",
    });
  });

  it("keeps the name a locked refusal disclosed, without a link", () => {
    // ADR-0005: the locked refusal carries the name so the prompt has context,
    // but nothing of the Collection itself was read — there is no page to link.
    expect(
      pdfBarView({ status: "locked", collectionName: "Flores Solares" }),
    ).toEqual({
      title: "Flores Solares",
      subtitle: "Collection PDF",
      href: null,
    });
  });

  it("is `Collection PDF` alone when no read disclosed a name", () => {
    const nameless: BarState[] = [
      { status: "loading" },
      { status: "invalid" },
      { status: "notFound" },
      { status: "private" },
      { status: "error" },
      // A locked refusal the server worded without a usable name.
      { status: "locked" },
      { status: "locked", collectionName: "" },
    ];

    for (const state of nameless) {
      expect(pdfBarView(state)).toEqual({
        title: "Collection PDF",
        subtitle: null,
        href: null,
      });
    }
  });
});
