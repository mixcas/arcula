import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  Artwork,
  ArtworkPhoto,
  Catalogue,
  SelectionPublicRead,
} from "@arcula/shared";

/**
 * One document component, two exports.
 *
 * The renderer is mocked because nothing here is about React-PDF's layout: the
 * assertion is the element both adapters hand it, which is what keeps a
 * Selection from growing a second renderer.
 */

const { pdfMock } = vi.hoisted(() => ({
  pdfMock: vi.fn(),
}));

vi.mock("@react-pdf/renderer", () => {
  const stub = () => null;
  return {
    Document: stub,
    Image: stub,
    Page: stub,
    Text: stub,
    View: stub,
    StyleSheet: { create: (styles: unknown) => styles },
    Font: {
      register: vi.fn(),
      registerHyphenationCallback: vi.fn(),
    },
    pdf: pdfMock,
  };
});

import { artworkPdfFields } from "@/components/pdf/cataloguePdfPreflight";
import { CataloguePdf } from "@/components/pdf/cataloguePdfDocument";
import { exportCatalogue } from "@/components/pdf/exportCatalogue";
import { exportSelection } from "@/components/pdf/selectionPdfExport";
import { buildSelectionPdfPlan } from "@/components/pdf/selectionPdfPlan";

const artwork = (id: string, overrides: Partial<Artwork> = {}): Artwork => ({
  id,
  userId: "owner-1",
  catalogueId: "catalogue-1",
  title: id,
  artistName: "Ana",
  photos: [],
  documents: [],
  ...overrides,
});

const selectionRead = (
  overrides: Partial<SelectionPublicRead> = {},
): SelectionPublicRead => ({
  selection: {
    id: "SSSSSSSSSSSSSSSSSSSS",
    name: "Winter shortlist",
    isPublic: true,
  },
  catalogueName: "Flores Solares",
  kind: "collection",
  ...overrides,
});

const catalogue: Catalogue = {
  id: "CCCCCCCCCCCCCCCCCCCC",
  name: "Flores Solares",
  kind: "collection",
  userId: "owner-1",
  isPublic: true,
};

const firstDocument = (): ReactElement<{
  title: string;
  pages: unknown;
  fields: unknown;
}> =>
  pdfMock.mock.calls[0][0] as ReactElement<{
    title: string;
    pages: unknown;
    fields: unknown;
  }>;

const photo = (id: string): ArtworkPhoto => ({
  id,
  order: 0,
  name: `${id}.jpg`,
  size: 100,
  contentType: "image/jpeg",
  width: 10,
  height: 10,
  original: { url: `/media/${id}`, size: 100, contentType: "image/jpeg" },
  variants: [
    {
      key: "xxlarge",
      url: `/media/${id}/xxlarge?selection=SSSSSSSSSSSSSSSSSSSS`,
      width: 10,
      height: 10,
      size: 100,
      contentType: "image/jpeg",
    },
  ],
});

afterEach(() => {
  pdfMock.mockReset();
  vi.unstubAllGlobals();
});

describe("the shared export run", () => {
  it("renders a Selection through the Catalogue's document component", async () => {
    pdfMock.mockImplementation(() => ({
      toBlob: () => Promise.resolve(new Blob(["pdf"])),
    }));
    const works = [
      artwork("draft", { status: "draft" }),
      artwork("published", { status: "published" }),
    ];

    const result = await exportSelection(selectionRead(), works);

    expect(result.pages).toBe(1);
    const document = firstDocument();
    expect(document.type).toBe(CataloguePdf);
    expect(document.props.title).toBe("Winter shortlist");
    expect(document.props.pages).toEqual(buildSelectionPdfPlan(works));
  });

  it("keeps the Catalogue export on the same component and its own title", async () => {
    pdfMock.mockImplementation(() => ({
      toBlob: () => Promise.resolve(new Blob(["pdf"])),
    }));

    await exportCatalogue(catalogue, [artwork("published")]);

    const document = firstDocument();
    expect(document.type).toBe(CataloguePdf);
    expect(document.props.title).toBe("Flores Solares");
  });

  it("prints a Selection with the source Catalogue's field choices", async () => {
    pdfMock.mockImplementation(() => ({
      toBlob: () => Promise.resolve(new Blob(["pdf"])),
    }));
    const read = selectionRead({
      kind: "portfolio",
      artworkFields: { medium: false, editions: false },
    });

    await exportSelection(read, [artwork("one")]);

    const document = firstDocument();
    expect(document.props.fields).toEqual(
      artworkPdfFields(read.kind, read.artworkFields),
    );
    expect(document.props.fields).toEqual({
      left: ["artistName", "serie"],
      right: ["dimensions", "dateOfCreation", "placeOfOrigin"],
    });
  });

  it("fetches a photo at the works read's URL verbatim, scope intact", async () => {
    pdfMock.mockImplementation(() => ({
      toBlob: () => Promise.resolve(new Blob(["pdf"])),
    }));
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    // The photo's decode fails in this environment; a failed photo is a
    // placeholder, which is exactly what makes the fetch itself observable.
    await exportSelection(selectionRead(), [
      artwork("with-photo", { photos: [photo("p1")] }),
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/media/p1/xxlarge?selection=SSSSSSSSSSSSSSSSSSSS",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });
});
