// @vitest-environment jsdom
import React, { useEffect } from "react";
// Registers the DOM matchers (`toBeDisabled`, …) with vitest's expect.
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DocumentsUploader from "@/components/manage/artwork/DocumentsUploader";
import {
  useArtworkDocuments,
  type UseArtworkDocuments,
} from "@/hooks/useArtworkDocuments";
import { mediaService } from "@/services/mediaService";
import { MAX_ARTWORK_DOCUMENTS, MAX_DOCUMENT_BYTES } from "@arcula/shared";
import type { ArtworkDocument } from "@arcula/shared";

/**
 * The staging boundary: the form never decodes or resizes a byte, so the
 * variants a row renders are the server's own answer, read back through the
 * mock. The geometry and the encoder are the API's, and the API suite pins
 * them.
 *
 * `vi.mock`'s factory is hoisted above the imports, so the default
 * implementations are installed in `beforeEach` instead.
 */
vi.mock("@/services/mediaService", () => ({
  mediaService: {
    stagePhoto: vi.fn(),
    processPhoto: vi.fn(),
    discardPhoto: vi.fn(),
    stageDocument: vi.fn(),
    processDocument: vi.fn(),
    discardDocument: vi.fn(),
  },
}));

// React 19 requires this flag for act() outside a browser environment.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements no matchMedia, and Mantine's responsive props resolve
// through `useMediaQuery`. The stub answers `true` only for the empty query,
// which is what Chrome does — a stub answering `false` for everything silently
// collapses every responsive prop to its smallest size.
Object.defineProperty(window, "matchMedia", {
  writable: true,
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

const COLLECTION_ID = "collection-1";
const ARTWORK_ID = "artwork-1";

const Harness: React.FC<{ initialDocuments?: ArtworkDocument[] }> = ({
  initialDocuments,
}) => {
  const documents = useArtworkDocuments({
    collectionId: COLLECTION_ID,
    artworkId: ARTWORK_ID,
    initialDocuments,
  });
  return (
    <MantineProvider>
      <ModalsProvider>
        <MemoryRouter>
          <DocumentsUploader documents={documents} />
        </MemoryRouter>
      </ModalsProvider>
    </MantineProvider>
  );
};

// Not async: the hook asks nothing of the server on mount, so there is no
// state update to settle before a test can assert.
const renderHarness = (initialDocuments?: ArtworkDocument[]) =>
  render(<Harness initialDocuments={initialDocuments} />);

/** A stored image document, with the two variants the app generates. */
const imageDocument = (id: string, name = `${id}.jpg`): ArtworkDocument => ({
  id,
  kind: "image",
  name,
  size: 1000,
  contentType: "image/jpeg",
  width: 2000,
  height: 1500,
  original: {
    url: `https://example.test/${id}-original.jpg`,
    size: 1000,
    contentType: "image/jpeg",
  },
  variants: [
    {
      key: "square_sm",
      url: `https://example.test/${id}-square_sm.webp`,
      width: 400,
      height: 400,
      size: 100,
      contentType: "image/webp",
    },
    {
      key: "large",
      url: `https://example.test/${id}-large.webp`,
      width: 1200,
      height: 800,
      size: 200,
      contentType: "image/webp",
    },
  ],
});

/** A stored non-image document. */
const fileDocument = (id: string, name: string): ArtworkDocument => ({
  id,
  kind: "file",
  name,
  size: 5000,
  contentType: "application/pdf",
  original: {
    url: `https://example.test/${id}-original.pdf`,
    size: 5000,
    contentType: "application/pdf",
  },
});

const jpegFile = (name: string): File =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });

const pdfFile = (name: string): File =>
  new File([new Uint8Array([1, 2, 3, 4])], name, { type: "application/pdf" });

/** The Dropzone's hidden file input. Throws rather than passing `null` to upload. */
const fileInput = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error("no file input rendered");
  }
  return input;
};

/**
 * Every entry id that passed through the stage mock, in arrival order.
 *
 * The ids are minted by the hook with `crypto.randomUUID`, so a test cannot
 * predict them; capturing them is what makes the discard assertions name the
 * exact object the server is being asked to drop.
 */
let stagedDocumentIds: string[];

beforeEach(() => {
  stagedDocumentIds = [];

  // A PDF is the one document the stage route answers without dimensions:
  // nothing to decode, so nulls are the honest shape.
  vi.mocked(mediaService.stageDocument).mockImplementation(
    (_cid, _aid, entryId, file) => {
      stagedDocumentIds.push(entryId);
      const isImage = file.type !== "application/pdf";
      return Promise.resolve({
        entryId,
        name: file.name,
        width: isImage ? 2000 : null,
        height: isImage ? 1500 : null,
        size: file.size,
        contentType: file.type,
        url: `https://media.test/staging-doc/${entryId}/original`,
      });
    },
  );
  // The two variants a document image actually gets — `square_sm` for the
  // row thumbnail, `large` for the preview modal. Named urls, not blobs:
  // there is no object-URL lifecycle left to test against.
  vi.mocked(mediaService.processDocument).mockImplementation(
    (_cid, _aid, entryId) =>
      Promise.resolve({
        entryId,
        variants: [
          {
            key: "square_sm",
            url: `https://media.test/variants-doc/${entryId}/square_sm.webp`,
            width: 400,
            height: 400,
            size: 100,
            contentType: "image/webp",
          },
          {
            key: "large",
            url: `https://media.test/variants-doc/${entryId}/large.webp`,
            width: 1200,
            height: 800,
            size: 200,
            contentType: "image/webp",
          },
        ],
      }),
  );
  vi.mocked(mediaService.discardDocument).mockResolvedValue(undefined);
});

afterEach(() => {
  // vitest.config.ts deliberately does not set `globals`, so Testing Library's
  // automatic cleanup never registers. Without this each render stays in the
  // document and the next test's queries match the previous test's rows.
  cleanup();
  vi.clearAllMocks();
});

describe("DocumentsUploader", () => {
  it("renders a stored image with its thumbnail and filename", () => {
    renderHarness([imageDocument("a", "reverse.jpg")]);

    // `square_sm` is the variant a document image gets, and the row has to
    // render it rather than reaching for a key this feature never generates.
    expect(screen.getByAltText("reverse.jpg")).toHaveAttribute(
      "src",
      "https://example.test/a-square_sm.webp",
    );
    expect(screen.getByText("reverse.jpg")).toBeInTheDocument();
  });

  it("renders a non-image with a file icon and its filename", () => {
    renderHarness([fileDocument("f", "condition-report.pdf")]);

    // No img element: a PDF has no variants, and an icon is the whole tile.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("condition-report.pdf")).toBeInTheDocument();
  });

  it("opens an image in a modal", async () => {
    const user = userEvent.setup();
    renderHarness([imageDocument("a", "reverse.jpg")]);

    await user.click(
      screen.getByRole("button", { name: /preview reverse.jpg/i }),
    );

    const dialog = await screen.findByRole("dialog");
    // `large`, not the original — same ladder photos use, and the reason the
    // modal can show a 2000x1500 source without pulling it over the wire.
    expect(
      within(dialog).getByRole("img", { name: "reverse.jpg" }),
    ).toHaveAttribute("src", "https://example.test/a-large.webp");
  });

  it("opens a non-image in a new tab, not a modal", () => {
    renderHarness([fileDocument("f", "condition-report.pdf")]);

    const link = screen.getByRole("link", { name: /condition-report.pdf/i });
    expect(link).toHaveAttribute("target", "_blank");
    // Not optional: without it the opened document gets a handle on this
    // window through window.opener.
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("href", "https://example.test/f-original.pdf");
  });

  it("does not open a non-image in a modal", async () => {
    const user = userEvent.setup();
    renderHarness([fileDocument("f", "receipt.pdf")]);

    // Clicking the label navigates, so the assertion is that no dialog was
    // mounted — a modal for a PDF would be a worse reader than the tab.
    await user.click(screen.getByRole("link", { name: /receipt.pdf/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("adds a PDF without asking the server for variants", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.upload(fileInput(), pdfFile("provenance.pdf"));

    expect(await screen.findByText("provenance.pdf")).toBeInTheDocument();
    // A PDF has no pixels: the client skips the process call on purpose, and
    // the row's link points at the staged original's proxy url.
    expect(mediaService.processDocument).not.toHaveBeenCalled();
    expect(mediaService.stageDocument).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("link", { name: /provenance.pdf/i }),
    ).toHaveAttribute(
      "href",
      `https://media.test/staging-doc/${stagedDocumentIds[0]}/original`,
    );
  });

  it("adds an image and asks the server for its variants", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.upload(fileInput(), [
      jpegFile("scan.jpg"),
      pdfFile("receipt.pdf"),
    ]);

    expect(await screen.findByText("scan.jpg")).toBeInTheDocument();
    expect(screen.getByText("receipt.pdf")).toBeInTheDocument();
    // One call, and only for the image's entry — the file is not a second
    // argument to the same call, and the pdf is not in it at all.
    expect(mediaService.processDocument).toHaveBeenCalledTimes(1);
    expect(mediaService.processDocument).toHaveBeenCalledWith(
      COLLECTION_ID,
      ARTWORK_ID,
      stagedDocumentIds[0],
    );
    // And the row renders the server's own thumbnail.
    expect(screen.getByAltText("scan.jpg")).toHaveAttribute(
      "src",
      `https://media.test/variants-doc/${stagedDocumentIds[0]}/square_sm.webp`,
    );
  });

  it("keeps the rest of a mixed drop and says why the other was refused", async () => {
    // Delivered the way the OS delivers it: both files on one change event,
    // whatever the `accept` hint said. `userEvent.upload` cannot do this —
    // it honours the `accept` attribute like the picker does, and would
    // quietly drop the spreadsheet before the event ever fired.
    renderHarness();
    const input = fileInput();
    Object.defineProperty(input, "files", {
      value: [
        jpegFile("good.jpg"),
        new File([new Uint8Array([1])], "sheet.xlsx", {
          type: "application/vnd.ms-excel",
        }),
      ],
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await waitFor(() => {
      expect(screen.getByText("good.jpg")).toBeInTheDocument();
    });
    // The spreadsheet never reaches the hook: the Dropzone's own validator
    // refuses it on the way in and routes it through the reject handler, which
    // starts the alert. The staging that settles a tick later has nothing to
    // add and must not erase that half of the list. Asserted by prefix, not by
    // the library's copy: the contract is that the file is named and
    // explained, and the wording belongs to the Dropzone.
    expect(screen.getByText("1 file could not be added")).toBeInTheDocument();
    expect(screen.getByText(/^sheet\.xlsx: /)).toBeInTheDocument();
    expect(screen.queryByText(/^sheet\.xlsx$/)).toBeNull();
  });

  it("removes a stored document without touching staging", async () => {
    const user = userEvent.setup();
    renderHarness([
      fileDocument("a", "first.pdf"),
      fileDocument("b", "second.pdf"),
    ]);

    await user.click(screen.getByRole("button", { name: /remove first.pdf/i }));

    await waitFor(() => {
      expect(screen.queryByText("first.pdf")).not.toBeInTheDocument();
    });
    expect(screen.getByText("second.pdf")).toBeInTheDocument();
    // Nothing was ever PUT for a stored document, so there is nothing to
    // discard: the save's PATCH omits the id and the server sweeps the
    // objects.
    expect(mediaService.discardDocument).not.toHaveBeenCalled();
  });

  it("discards a staged document when it is removed", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.upload(fileInput(), pdfFile("receipt.pdf"));
    const entryId = stagedDocumentIds[0];
    const remove = await screen.findByRole("button", { name: /remove/i });
    await user.click(remove);

    await waitFor(() => {
      expect(screen.queryByText("receipt.pdf")).not.toBeInTheDocument();
    });
    // Fire-and-forget, so await the assertion rather than the call.
    await waitFor(() => {
      expect(mediaService.discardDocument).toHaveBeenCalledWith(
        COLLECTION_ID,
        ARTWORK_ID,
        entryId,
      );
    });
  });

  it("reports a file over the 25 MB cap with a reason", async () => {
    // The Dropzone enforces `maxSize` itself and never calls `onDrop` for an
    // oversized file, so this is a different code path from the hook's own
    // checks, and it is the one that actually fires for a 30 MB condition
    // report. With the reason dropped on the floor the user gets a one-frame
    // flicker and a file that simply does not appear.
    const user = userEvent.setup();
    renderHarness();

    // A real allocation rather than a stubbed `size`: react-dropzone reads
    // `file.size` off the object, and a File whose size is faked is not one
    // the rule is being exercised on.
    const huge = new File(
      [new Uint8Array(MAX_DOCUMENT_BYTES + 1024)],
      "catalogue.pdf",
      { type: "application/pdf" },
    );
    await user.upload(fileInput(), huge);

    const line = await screen.findByText(/catalogue\.pdf: /i);
    // Matched loosely on purpose. The claim is that a *reason* reached the
    // user rather than a bare filename; Mantine's exact wording is its own to
    // change, and pinning it here would break this test for a reason that says
    // nothing about the behaviour being covered.
    expect(line.textContent).toMatch(/larger than/i);
  });
});

/**
 * The hook alone, handed back through an effect.
 *
 * The value is read *after* `run`, so it is the post-change hook and not a
 * snapshot of the pre-change one. React's rules are right that reassigning a
 * variable from outside the component is a side effect, and a test only needs
 * the value a tick later anyway.
 *
 * `run` returns nothing and writes what it wants to assert on into a closure
 * variable. `await act(async () => …)` resolves to `undefined` whatever the
 * callback returned, so returning a result out of it silently yields nothing.
 */
const withHook = async (
  initialDocuments: ArtworkDocument[],
  run: (documents: UseArtworkDocuments) => void | Promise<void>,
): Promise<UseArtworkDocuments> => {
  let latest: UseArtworkDocuments | null = null;
  const Probe: React.FC = () => {
    const documents = useArtworkDocuments({
      collectionId: COLLECTION_ID,
      artworkId: ARTWORK_ID,
      initialDocuments,
    });
    useEffect(() => {
      latest = documents;
    }, [documents]);
    return null;
  };
  render(
    <MantineProvider>
      <Probe />
    </MantineProvider>,
  );
  await waitFor(() => {
    expect(latest).not.toBeNull();
  });
  await run(latest as UseArtworkDocuments);
  return latest as UseArtworkDocuments;
};

type AddFilesResult = Awaited<ReturnType<UseArtworkDocuments["addFiles"]>>;

describe("addFiles", () => {
  it("tags an image for processing and a file for nothing else", async () => {
    let result: AddFilesResult = { added: [], rejected: [] };
    await withHook([], async (hook) => {
      await act(async () => {
        result = await hook.addFiles([
          jpegFile("scan.jpg"),
          pdfFile("receipt.pdf"),
        ]);
      });
    });

    // The kind is the one the save's promotion branches on, so the two stay in
    // step without either side inspecting a MIME type. The image carries the
    // server's dimensions and variants; the file is complete after staging
    // alone.
    expect(result.added.map((entry) => entry.document.kind)).toEqual([
      "image",
      "file",
    ]);
    const [imageEntry, fileEntry] = result.added;
    expect(imageEntry.document).toMatchObject({
      width: 2000,
      height: 1500,
    });
    // A file document has no geometry at all: the fields are absent, not
    // null. (The stage route answers nulls for it, and the entry shape drops
    // them on the way in.)
    expect("width" in fileEntry.document).toBe(false);
    expect("height" in fileEntry.document).toBe(false);
    expect(mediaService.processDocument).toHaveBeenCalledTimes(1);
  });

  it("refuses a type the allowlist does not admit, without staging", async () => {
    // Driven through the hook, not the Dropzone: react-dropzone filters by the
    // `accept` map before `onDrop` fires, so a picker-chosen `.xlsx` never
    // reaches the hook at all — the check here is the second line, and it is
    // the one a caller that bypasses the component would meet.
    let result: AddFilesResult = { added: [], rejected: [] };
    await withHook([], async (hook) => {
      await act(async () => {
        result = await hook.addFiles([
          jpegFile("good.jpg"),
          new File([new Uint8Array([1])], "sheet.xlsx", {
            type: "application/vnd.ms-excel",
          }),
        ]);
      });
    });

    expect(result.added).toHaveLength(1);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: "Not a supported file type" }),
    ]);
  });

  it("refuses over the cap without staging anything", async () => {
    // Counted against the cap as the drop is processed, so a drop of twelve
    // with a limit of ten keeps the first ten rather than rejecting all
    // twelve, and nothing over the line spends a round trip.
    let result: AddFilesResult = { added: [], rejected: [] };
    await withHook([], async (hook) => {
      await act(async () => {
        result = await hook.addFiles(
          Array.from({ length: 12 }, (_, index) => pdfFile(`doc-${index}.pdf`)),
        );
      });
    });

    expect(result.added).toHaveLength(MAX_ARTWORK_DOCUMENTS);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0]?.reason).toBe(
      `Only ${MAX_ARTWORK_DOCUMENTS} documents per artwork`,
    );
  });

  it("stops adding once the list is full", async () => {
    let result: AddFilesResult = { added: [], rejected: [] };
    await withHook(
      Array.from({ length: MAX_ARTWORK_DOCUMENTS }, (_, index) =>
        fileDocument(`d${index}`, `stored-${index}.pdf`),
      ),
      async (hook) => {
        await act(async () => {
          result = await hook.addFiles([pdfFile("one-too-many.pdf")]);
        });
      },
    );

    expect(result.added).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe(
      `Only ${MAX_ARTWORK_DOCUMENTS} documents per artwork`,
    );
    expect(mediaService.stageDocument).not.toHaveBeenCalled();
  });

  it("leaves no gap when a file fails mid-batch", async () => {
    // A failure in the middle must not cost the drop the files that came after
    // it: the batch is appended once everything has settled, in drop order, so
    // the survivors keep their places.
    vi.mocked(mediaService.stageDocument).mockImplementation(
      (_cid, _aid, entryId, file) => {
        if (file.name === "fail.pdf") {
          return Promise.reject(new Error("staging failed"));
        }
        stagedDocumentIds.push(entryId);
        return Promise.resolve({
          entryId,
          name: file.name,
          width: null,
          height: null,
          size: file.size,
          contentType: file.type,
          url: `https://media.test/staging-doc/${entryId}/original`,
        });
      },
    );
    let result: AddFilesResult = { added: [], rejected: [] };
    await withHook([], async (hook) => {
      await act(async () => {
        result = await hook.addFiles([
          pdfFile("one.pdf"),
          pdfFile("fail.pdf"),
          pdfFile("two.pdf"),
        ]);
      });
    });

    expect(result.added.map((entry) => entry.document.name)).toEqual([
      "one.pdf",
      "two.pdf",
    ]);
    expect(
      result.rejected.map((entry) => [entry.file.name, entry.reason]),
    ).toEqual([["fail.pdf", "The file could not be uploaded"]]);
  });

  it("discards the staged original when the variants fail", async () => {
    // The original is up and no save will ever name it: without the discard it
    // lingers until the sweep, and a failed batch would leave objects behind
    // per image.
    vi.mocked(mediaService.processDocument).mockRejectedValue(
      new Error("boom"),
    );
    let result: AddFilesResult = { added: [], rejected: [] };
    await withHook([], async (hook) => {
      await act(async () => {
        result = await hook.addFiles([jpegFile("scan.jpg")]);
      });
    });

    expect(result.added).toHaveLength(0);
    await waitFor(() => {
      expect(mediaService.discardDocument).toHaveBeenCalledWith(
        COLLECTION_ID,
        ARTWORK_ID,
        stagedDocumentIds[0],
      );
    });
  });
});

describe("commit", () => {
  it("leaves the field out of a save when nothing changed", async () => {
    const hook = await withHook([fileDocument("a", "a.pdf")], () => {});

    // `commit` returning null is what keeps a save that only touched the title
    // from rewriting every object for no change: an absent key leaves the
    // stored set alone.
    expect(hook.commit()).toBeNull();
  });

  it("commits the shorter set when a document is removed", async () => {
    const hook = await withHook(
      [fileDocument("a", "a.pdf"), fileDocument("b", "b.pdf")],
      (inner) => {
        act(() => {
          inner.remove(inner.entries[0].key);
        });
      },
    );

    expect(hook.commit()).toEqual([{ entryId: "b", name: "b.pdf" }]);
  });

  it("carries a staged-only addition even though the stored set is untouched", async () => {
    // The case that distinguishes this comparison from a plain set check:
    // removing nothing and adding one is still a change the patch has to carry,
    // and a set comparison of the stored half alone would answer "unchanged".
    const hook = await withHook([fileDocument("a", "a.pdf")], async (inner) => {
      await act(async () => {
        await inner.addFiles([pdfFile("b.pdf")]);
      });
    });

    const committed = hook.commit();
    expect(committed?.map((entry) => entry.entryId)).toEqual([
      "a",
      stagedDocumentIds[0],
    ]);
    expect(committed?.map((entry) => entry.name)).toEqual(["a.pdf", "b.pdf"]);
  });
});
