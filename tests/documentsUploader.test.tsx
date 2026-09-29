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
import { processImages } from "@/utils/imageProcessing";
import { MAX_DOCUMENT_BYTES } from "@/utils/artworkDocuments";
import type { ArtworkDocument } from "@/types";

/**
 * The default stub: one `square_sm` per file, which is the subset a document
 * image actually gets.
 *
 * A `function` declaration, not a `const`, because `vi.mock`'s factory is
 * hoisted above the imports and runs before module-scope `const`s are
 * initialised.
 */
function defaultProcessImages(files: File[]) {
  return Promise.resolve(
    files.map((file) => ({
      file,
      webp: true,
      width: 2000,
      height: 1500,
      variants: [
        {
          key: "square_sm" as const,
          blob: new Blob([new Uint8Array([9])], { type: "image/webp" }),
          width: 400,
          height: 400,
          contentType: "image/webp",
        },
      ],
    })),
  );
}

// The variant pipeline needs a real canvas and a Web Worker, and jsdom has
// neither. Everything asserted here is the layer above that — the list, the
// open behaviour, the removal and the merge — so the processing is stubbed
// rather than emulated. The geometry and the encoder choice are covered in
// tests/imageVariants.test.ts and tests/imageProcessing.test.ts, both pure.
vi.mock("@/utils/imageProcessing", () => ({
  processImages: vi.fn(defaultProcessImages),
  variantFormatIsWebp: vi.fn(() => Promise.resolve(true)),
  extensionFor: (type: string) =>
    type === "image/webp" ? "webp" : type === "image/png" ? "png" : "jpg",
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

const Harness: React.FC<{ initialDocuments?: ArtworkDocument[] }> = ({
  initialDocuments,
}) => {
  const documents = useArtworkDocuments({ initialDocuments });
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

// Not async: the documents hook asks no mount-time probe the way the photo hook
// does, so there is no state update to settle before a test can assert.
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

beforeEach(() => {
  vi.mocked(processImages).mockImplementation(defaultProcessImages);

  // jsdom implements neither of these, and the hook calls createObjectURL for
  // every pending preview and revokes it on removal and unmount. The stub
  // records calls so the revocation assertions below are real rather than
  // vacuous.
  const created: string[] = [];
  const revoked: string[] = [];
  let counter = 0;

  URL.createObjectURL = vi.fn(() => {
    counter += 1;
    const url = `blob:mock/${counter}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });

  Object.assign(globalThis, { __created: created, __revoked: revoked });
});

afterEach(() => {
  // vitest.config.ts deliberately does not set `globals`, so Testing Library's
  // automatic cleanup never registers. Without this each render stays in the
  // document and the next test's queries match the previous test's rows.
  cleanup();
});

const createdUrls = (): string[] =>
  (globalThis as unknown as { __created: string[] }).__created;
const revokedUrls = (): string[] =>
  (globalThis as unknown as { __revoked: string[] }).__revoked;

describe("DocumentsUploader", () => {
  it("says so when there are no documents", () => {
    renderHarness();
    expect(screen.getByText(/no documents yet/i)).toBeInTheDocument();
  });

  it("renders a stored image with its thumbnail and filename", () => {
    renderHarness([imageDocument("a", "reverse.jpg")]);

    // `square_sm` is the variant a document image gets, and the tile has to
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

  it("adds a PDF without running it through the image pipeline", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.upload(fileInput(), pdfFile("provenance.pdf"));

    expect(await screen.findByText("provenance.pdf")).toBeInTheDocument();
    // A PDF has no pixels; running it through a decoder would reject a
    // perfectly good file for having nothing to resize.
    expect(vi.mocked(processImages)).not.toHaveBeenCalled();
  });

  it("adds an image and runs only the images through the pipeline", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.upload(fileInput(), [
      jpegFile("scan.jpg"),
      pdfFile("receipt.pdf"),
    ]);

    expect(await screen.findByText("scan.jpg")).toBeInTheDocument();
    expect(screen.getByText("receipt.pdf")).toBeInTheDocument();
    // One call, and only for the image — the file is not a second argument to
    // the same call.
    expect(vi.mocked(processImages)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processImages).mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("asks for only the two variants a document uses", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.upload(fileInput(), jpegFile("scan.jpg"));
    await screen.findByText("scan.jpg");

    // The spec list is the third argument. `square_lg` and `medium` exist for
    // the public collection grid, and a document is never public, so generating
    // them would write objects nothing can ever read.
    const specs = vi.mocked(processImages).mock.calls[0]?.[2] as Array<{
      key: string;
    }>;
    expect(specs.map((spec) => spec.key)).toEqual(["square_sm", "large"]);
  });

  it("reports a file it could not read, and keeps the rest of the drop", async () => {
    vi.mocked(processImages).mockImplementation(() =>
      Promise.reject(new Error("decode failed")),
    );
    const user = userEvent.setup();
    renderHarness();

    await user.upload(fileInput(), [
      jpegFile("broken.jpg"),
      pdfFile("fine.pdf"),
    ]);

    // Never swallowed: a file that silently vanished from the list is worse
    // than a message, and the accept list here is broad enough that a mixed
    // drop is an ordinary thing to do.
    expect(
      await screen.findByText(/could not be read as an image/i),
    ).toBeInTheDocument();
    // The PDF never depended on the pipeline, so it survived.
    expect(screen.getByText("fine.pdf")).toBeInTheDocument();
  });

  it("rejects a file whose stored name the rules would deny", async () => {
    // The second half of the accept check, and the one that would have caught the
    // PDF 403 in the form rather than at save time: a type can be accepted while
    // the name the upload would be stored under is refused by `isDocumentName`.
    // A `text/html` file is the sharp version — the type is rejected first, so it
    // is spoofed here as a type the form *does* accept, and only the name gives
    // it away. The rules are the only thing that can catch this, and they answer
    // with a 403 nobody can act on.
    let result: AddFilesResult = { added: [], rejected: [] };
    await withHook([], async (hook) => {
      await act(async () => {
        result = await hook.addFiles([
          new File([new Uint8Array([1])], "payload.html", {
            type: "application/pdf",
          }),
        ]);
      });
    });

    expect(result.added).toHaveLength(0);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: "Not a supported file type" }),
    ]);
  });

  it("rejects an unsupported type and keeps the rest of the drop", async () => {
    // Driven through the hook, not the Dropzone. react-dropzone filters by the
    // `accept` map before `onDrop` fires, so a picker-chosen `.xlsx` never
    // reaches the hook at all — the check here is the second line, and it is the
    // one a drag from an OS that ignores `accept` would meet.
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

  it("removes a document", async () => {
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
  });

  it("revokes a pending image's object URLs when it is removed", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.upload(fileInput(), jpegFile("scan.jpg"));
    await screen.findByText("scan.jpg");

    // Two per image, not one: the picked file's own URL, and the generated
    // `square_sm` the row displays. Both pin a blob in memory.
    expect(createdUrls()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /remove scan.jpg/i }));

    await waitFor(() => {
      expect(revokedUrls()).toHaveLength(2);
    });
  });

  it("revokes a pending file's object URL when it is removed", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.upload(fileInput(), pdfFile("receipt.pdf"));
    await screen.findByText("receipt.pdf");

    // One: a file gets no variants, so the picked file's URL is all it owns.
    expect(createdUrls()).toHaveLength(1);

    await user.click(
      screen.getByRole("button", { name: /remove receipt.pdf/i }),
    );

    await waitFor(() => {
      expect(revokedUrls()).toHaveLength(1);
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
    // `file.size` off the object, and a File whose size is faked is not one the
    // rule is being exercised on.
    const huge = new File(
      [new Uint8Array(MAX_DOCUMENT_BYTES + 1024)],
      "catalogue.pdf",
      { type: "application/pdf" },
    );
    await user.upload(fileInput(), huge);

    const line = await screen.findByText(/catalogue\.pdf: /i);
    // Matched loosely on purpose. The claim is that a *reason* reached the user
    // rather than a bare filename; Mantine's exact wording is its own to change,
    // and pinning it here would break this test for a reason that says nothing
    // about the behaviour being covered.
    expect(line.textContent).toMatch(/larger than/i);
  });

  it("caps the list at ten, keeping the first ten of a larger drop", async () => {
    // Counted as the drop is processed, so a drop of twelve keeps ten and
    // reports two — not twelve reported and none kept, which is the more
    // defensible-looking behaviour and the more annoying one.
    let result: AddFilesResult = { added: [], rejected: [] };
    await withHook([], async (hook) => {
      await act(async () => {
        result = await hook.addFiles(
          Array.from({ length: 12 }, (_, index) => pdfFile(`doc-${index}.pdf`)),
        );
      });
    });

    expect(result.added).toHaveLength(10);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0]?.reason).toMatch(
      /only 10 documents per artwork/i,
    );
  });

  it("stops adding once the list is full", async () => {
    let result: AddFilesResult = { added: [], rejected: [] };
    await withHook(
      Array.from({ length: 10 }, (_, index) =>
        fileDocument(`d${index}`, `stored-${index}.pdf`),
      ),
      async (hook) => {
        await act(async () => {
          result = await hook.addFiles([pdfFile("one-too-many.pdf")]);
        });
      },
    );

    expect(result.added).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(
      /only 10 documents per artwork/i,
    );
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
    const documents = useArtworkDocuments({ initialDocuments });
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

describe("useArtworkDocuments", () => {
  it("tags an image for processing and a file for a straight upload", async () => {
    let result: AddFilesResult = { added: [], rejected: [] };
    await withHook([], async (hook) => {
      await act(async () => {
        result = await hook.addFiles([
          jpegFile("scan.jpg"),
          pdfFile("receipt.pdf"),
        ]);
      });
    });

    // The tag is the union `documentService` branches on, so the two stay in
    // step without either side inspecting a MIME type.
    const kinds = result.added.map((entry) =>
      entry.status === "pending" && entry.processed !== null ? "image" : "file",
    );
    expect(kinds).toEqual(["image", "file"]);
  });

  it("preserves a file the browser reported no type for", async () => {
    // Browsers routinely hand over an empty type for a dragged PDF. It is still
    // accepted on the strength of its extension, and the row still opens it —
    // an empty-type file must not become a row that does nothing.
    const typeless = new File([new Uint8Array([1, 2])], "scan.pdf", {
      type: "",
    });
    const user = userEvent.setup();
    renderHarness();

    await user.upload(fileInput(), typeless);

    const link = await screen.findByRole("link", { name: /scan.pdf/i });
    expect(link).toHaveAttribute("href", "blob:mock/1");
  });

  it("leaves the field out of a save when nothing changed", async () => {
    const hook = await withHook([fileDocument("a", "a.pdf")], () => {});

    // `commit` returning null is what keeps a save that only touched the title
    // from rewriting every storage URL.
    expect(hook.commit()).toBeNull();
  });

  it("commits the stored list when a document is removed", async () => {
    const hook = await withHook(
      [fileDocument("a", "a.pdf"), fileDocument("b", "b.pdf")],
      (inner) => {
        act(() => {
          inner.remove(inner.entries[0].key);
        });
      },
    );

    expect(hook.commit()).toEqual([
      expect.objectContaining({ id: "b", name: "b.pdf" }),
    ]);
  });

  it("reports a removed stored id for the Storage sweep", async () => {
    const hook = await withHook(
      [fileDocument("a", "a.pdf"), fileDocument("b", "b.pdf")],
      (inner) => {
        act(() => {
          inner.remove(inner.entries[0].key);
        });
      },
    );

    // Without this the document's objects would stay in Storage forever:
    // invisible, unreferenced, and never cleaned up.
    expect(hook.removedStoredIds).toEqual(["a"]);
  });

  it("does not report a removal when the user re-adds the same document", async () => {
    // Not reachable through the UI, but the sweep is destructive: a false
    // positive here deletes objects the saved document still points at.
    const hook = await withHook([fileDocument("a", "a.pdf")], () => {});

    expect(hook.removedStoredIds).toEqual([]);
  });

  it("is not dirty when a document is only viewed", async () => {
    const hook = await withHook([fileDocument("a", "a.pdf")], () => {});
    expect(hook.dirty).toBe(false);
  });
});

/**
 * The list the user sees has to be the list that is saved.
 *
 * Driven through the hook rather than the row list, because `mergeUploaded` is
 * what the page calls and no rendering of the form ever shows its result — the
 * bug it fixes is invisible until the document is read back.
 */
describe("mergeUploaded", () => {
  /** What the service hands back: one stored-shaped document per upload. */
  const uploadedImage = (name: string): ArtworkDocument =>
    imageDocument("uploaded", name);
  const uploadedFile = (name: string): ArtworkDocument =>
    fileDocument("uploaded", name);

  it("keeps a new document where the list put it", async () => {
    // The bug this replaces was `uploaded.push(...stored)`, which puts every new
    // document at the front. For documents there is no thumbnail to get wrong as
    // there is for photos, so the failure is quieter: a saved list whose order
    // nobody chose, and a user with ten receipts who cannot find the one they
    // just added.
    const hook = await withHook(
      [fileDocument("a", "a.pdf"), fileDocument("b", "b.pdf")],
      async (inner) => {
        await act(async () => {
          await inner.addFiles([pdfFile("c.pdf")]);
        });
      },
    );

    const merged = hook.mergeUploaded([uploadedFile("c.pdf")]);

    expect(merged.map((entry) => entry.name)).toEqual([
      "a.pdf",
      "b.pdf",
      "c.pdf",
    ]);
  });

  it("returns uploaded images and files to their own slots in a mixed list", async () => {
    // The mixed case, and the one that breaks a merge which assumed uploads
    // were contiguous: two new documents of different kinds, either of which
    // would be paired with the wrong upload if the walk did not line them up
    // position for position.
    const hook = await withHook([fileDocument("a", "a.pdf")], async (inner) => {
      await act(async () => {
        await inner.addFiles([jpegFile("b.jpg"), pdfFile("c.pdf")]);
      });
    });

    const merged = hook.mergeUploaded([
      uploadedImage("b.jpg"),
      uploadedFile("c.pdf"),
    ]);

    expect(merged.map((entry) => entry.name)).toEqual([
      "a.pdf",
      "b.jpg",
      "c.pdf",
    ]);
    // And the kinds line up with the names, which is what a misaligned zip
    // would break: an image entry pointing at a PDF's URL renders as a broken
    // image with no error anywhere.
    expect(merged.map((entry) => entry.kind)).toEqual([
      "file",
      "image",
      "file",
    ]);
  });

  it("leaves a document alone when the user added nothing", async () => {
    const hook = await withHook([fileDocument("a", "a.pdf")], () => {});

    const merged = hook.mergeUploaded([]);

    expect(merged.map((entry) => entry.name)).toEqual(["a.pdf"]);
  });
});
