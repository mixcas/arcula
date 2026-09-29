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
import PhotoUploader from "@/components/manage/artwork/PhotoUploader";
import {
  useArtworkPhotos,
  type UseArtworkPhotos,
} from "@/hooks/useArtworkPhotos";
import { processImages, variantFormatIsWebp } from "@/utils/imageProcessing";
import type { ArtworkPhoto } from "@/types";

/**
 * The default stub: one WebP `square_lg` per file, as a working browser gives.
 *
 * A `function` declaration, not a `const`, because `vi.mock`'s factory is
 * hoisted above the imports and runs before module-scope `const`s are
 * initialised. It is also reassigned onto the mock in `beforeEach`, so a test
 * that changes the encoder's answer does not leak into the next one.
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
          key: "square_lg" as const,
          blob: new Blob([new Uint8Array([9])], { type: "image/webp" }),
          width: 800,
          height: 800,
          contentType: "image/webp",
        },
      ],
    })),
  );
}

// The variant pipeline needs a real canvas and a Web Worker, and jsdom has
// neither. Everything asserted here is the layer above that — the list, the
// ordering and the removal — so the processing is stubbed rather than
// emulated. The geometry and the encoder choice are covered separately in
// tests/imageVariants.test.ts and tests/imageProcessing.test.ts, both of which
// are pure and run in node.
//
// The stub returns a real variant, because the form now previews the generated
// WebP rather than the file that was picked. A stub returning none would fall
// through to the original and quietly test the fallback path instead.
vi.mock("@/utils/imageProcessing", () => ({
  processImages: vi.fn(defaultProcessImages),
  // Asked once on mount. jsdom has no canvas, so the real probe answers "no
  // WebP" and the JPEG warning would be showing in every other test here.
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
// which is what Chrome does — a stub that answers `false` for everything
// silently collapses every responsive prop to its smallest size.
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

// `useModals` throws without a provider, and the Dropzone is the only thing
// here that needs it. Rendered anyway so adding a modal later cannot silently
// break these tests.
const Harness: React.FC<{ initialPhotos?: ArtworkPhoto[] }> = ({
  initialPhotos,
}) => {
  const photos = useArtworkPhotos({ initialPhotos });
  return (
    <MantineProvider>
      <ModalsProvider>
        <MemoryRouter>
          <PhotoUploader photos={photos} />
        </MemoryRouter>
      </ModalsProvider>
    </MantineProvider>
  );
};

/**
 * Renders the harness and lets the mount-time probe settle.
 *
 * The hook asks the browser what it can encode on mount, so there is a state
 * update a tick after any render. A test that asserts synchronously would
 * finish first and leave that update to land afterwards, which React reports
 * as an unwrapped `act`. Awaiting the probe keeps it inside one.
 */
const renderHarness = async (initialPhotos?: ArtworkPhoto[]) => {
  const result = render(<Harness initialPhotos={initialPhotos} />);
  await waitFor(() => {
    expect(variantFormatIsWebp).toHaveBeenCalled();
  });
  return result;
};

const photo = (
  id: string,
  order: number,
  name = `${id}.jpg`,
): ArtworkPhoto => ({
  id,
  order,
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
      key: "square_lg",
      url: `https://example.test/${id}-square_lg.webp`,
      width: 800,
      height: 800,
      size: 100,
      contentType: "image/webp",
    },
  ],
});

const jpegFile = (name: string): File =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });

/** The Dropzone's hidden file input. Throws rather than passing `null` to upload. */
const fileInput = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error("no file input rendered");
  }
  return input;
};

beforeEach(() => {
  // Restored rather than left as each test found it: the format tests below
  // change both answers, and a stub that survived would make every later test
  // assert on a WebP-less browser.
  vi.mocked(processImages).mockImplementation(defaultProcessImages);
  vi.mocked(variantFormatIsWebp).mockResolvedValue(true);

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
  // document and the next test's queries match the previous test's tiles.
  cleanup();
});

const createdUrls = (): string[] =>
  (globalThis as unknown as { __created: string[] }).__created;
const revokedUrls = (): string[] =>
  (globalThis as unknown as { __revoked: string[] }).__revoked;

describe("PhotoUploader", () => {
  it("explains the thumbnail rule when there are no photos", async () => {
    await renderHarness();
    expect(
      screen.getByText(/first image is the one used as the thumbnail/i),
    ).toBeInTheDocument();
  });

  it("renders the stored photos in order, badging index 0 as the thumbnail", async () => {
    await renderHarness([
      photo("a", 0, "first.jpg"),
      photo("b", 1, "second.jpg"),
    ]);

    // The badge is the contract: the tile at index 0 is the one the rest of the
    // app uses as the primary image, and this is where that is made visible.
    expect(screen.getByText("Thumbnail")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("orders by the stored `order` field, not by array position", async () => {
    await renderHarness([
      photo("b", 1, "second.jpg"),
      photo("a", 0, "first.jpg"),
    ]);

    const names = screen.getAllByText(/\.jpg$/).map((node) => node.textContent);
    expect(names).toEqual(["first.jpg", "second.jpg"]);
    // And the reordered-by-`order` one is the thumbnail.
    expect(screen.getByText("Thumbnail")).toBeInTheDocument();
  });

  it("moves a photo to the front and makes it the thumbnail", async () => {
    const user = userEvent.setup();
    await renderHarness([
      photo("a", 0, "first.jpg"),
      photo("b", 1, "second.jpg"),
    ]);

    // Only the non-primary tile offers the action, so there is exactly one
    // button to click and no need to disambiguate.
    const promote = screen.getByRole("button", { name: /use as thumbnail/i });
    await user.click(promote);

    await waitFor(() => {
      const names = screen
        .getAllByText(/\.jpg$/)
        .map((node) => node.textContent);
      expect(names).toEqual(["second.jpg", "first.jpg"]);
    });
    // Two thumbnails would mean the invariant broke.
    expect(screen.getAllByText("Thumbnail")).toHaveLength(1);
  });

  it("removes a photo", async () => {
    const user = userEvent.setup();
    await renderHarness([
      photo("a", 0, "first.jpg"),
      photo("b", 1, "second.jpg"),
    ]);

    const remove = screen.getAllByRole("button", { name: /remove image/i })[0];
    await user.click(remove);

    await waitFor(() => {
      expect(screen.queryByText("first.jpg")).not.toBeInTheDocument();
    });
    expect(screen.getByText("second.jpg")).toBeInTheDocument();
  });

  it("opens a full-screen preview when a stored photo is clicked", async () => {
    const user = userEvent.setup();
    await renderHarness([photo("a", 0, "first.jpg")]);

    await user.click(screen.getByAltText("first.jpg"));

    // The modal is portalled out of the render tree, so it is queried by role
    // rather than by being nested under the grid.
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("img", { name: "first.jpg" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("1 of 1")).toBeInTheDocument();
  });

  it("previews the large variant rather than the original", async () => {
    const user = userEvent.setup();
    const stored = photo("a", 0);
    // A `large` variant alongside the square one the tile uses, so the
    // assertion can tell which was picked.
    stored.variants = [
      ...stored.variants,
      {
        key: "large",
        url: "https://example.test/a-large.webp",
        width: 1200,
        height: 800,
        size: 200,
        contentType: "image/webp",
      },
    ];
    await renderHarness([stored]);

    await user.click(screen.getByAltText("a.jpg"));

    const dialog = await screen.findByRole("dialog");
    const image = within(dialog).getByRole("img", { name: "a.jpg" });
    expect(image).toHaveAttribute("src", "https://example.test/a-large.webp");
  });

  it("revokes a pending photo's object URLs when it is removed", async () => {
    const user = userEvent.setup();
    await renderHarness();

    const input = fileInput();
    expect(input).not.toBeNull();
    await user.upload(input, [
      jpegFile("new-one.jpg"),
      jpegFile("new-two.jpg"),
    ]);

    await waitFor(() => {
      expect(screen.getByText("new-one.jpg")).toBeInTheDocument();
    });
    // Two per photo, not one: the picked file's own URL, and the generated
    // `square_lg` the tile actually displays. Both pin a blob in memory.
    expect(createdUrls()).toHaveLength(4);

    const remove = screen.getAllByRole("button", { name: /remove image/i })[0];
    await user.click(remove);

    // The browser holds the decoded bytes alive until this happens, and a
    // removed tile that keeps its blob is a leak the user can trigger ten
    // times over.
    await waitFor(() => {
      expect(revokedUrls()).toHaveLength(2);
    });
    expect(screen.queryByText("new-one.jpg")).not.toBeInTheDocument();
  });

  it("rejects a file that is not an image and keeps the rest of the drop", async () => {
    const user = userEvent.setup();
    await renderHarness();

    await user.upload(fileInput(), [
      jpegFile("good.jpg"),
      new File([new Uint8Array([1])], "notes.pdf", { type: "application/pdf" }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("good.jpg")).toBeInTheDocument();
    });
    expect(screen.queryByText("notes.pdf")).not.toBeInTheDocument();
  });

  it("shows an empty-state hint before any image is added", async () => {
    await renderHarness();
    expect(screen.getByText(/drag images here/i)).toBeInTheDocument();
  });

  it("previews the generated variant, not the picked file, before upload", async () => {
    const user = userEvent.setup();
    await renderHarness();

    await user.upload(fileInput(), jpegFile("scan.jpg"));

    const tile = await screen.findByRole("img", { name: "scan.jpg" });
    // The picked file's object URL is minted first and the variant's second,
    // so the number says which one is on screen. Displaying the first would
    // mean the form shows the `.jpg` from disk and hides the WebP that is
    // about to be stored — which is exactly what made the format look wrong.
    expect(tile).toHaveAttribute("src", "blob:mock/2");
  });

  it("opens a full-screen preview of a photo that has not been uploaded", async () => {
    const user = userEvent.setup();
    await renderHarness();

    await user.upload(fileInput(), jpegFile("scan.jpg"));
    await user.click(await screen.findByRole("img", { name: "scan.jpg" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("img", { name: "scan.jpg" }),
    ).toBeInTheDocument();
  });

  it("keeps the variants it generated instead of generating them again", async () => {
    const user = userEvent.setup();
    await renderHarness();

    await user.upload(fileInput(), jpegFile("scan.jpg"));
    await waitFor(() => {
      expect(screen.getByText("scan.jpg")).toBeInTheDocument();
    });

    // The save path hands `photos.pendingImages` straight to the service, so a
    // second call here would be a full second pass of decode-and-resize per
    // photo for nothing.
    expect(vi.mocked(processImages)).toHaveBeenCalledTimes(1);
  });
});

/**
 * The order the user set has to survive the save.
 *
 * Driven through the hook rather than the tile grid, because `mergeUploaded` is
 * what the page calls and no rendering of the form ever shows its result — the
 * bug it fixes was invisible until the document was read back.
 */
describe("mergeUploaded", () => {
  /** What the service hands back: one stored-shaped photo per upload. */
  const uploadedFor = (name: string): ArtworkPhoto => ({
    ...photo("uploaded", 0, name),
    original: {
      url: `https://example.test/${name}`,
      size: 1,
      contentType: "image/jpeg",
    },
  });

  /**
   * Renders the hook alone; every assertion here is about the merge.
   *
   * The hook is handed back through an effect rather than assigned during
   * render — React's rules are right that reassigning a variable from outside
   * the component is a side effect, and a test only needs the value a tick
   * later anyway. The returned value is read *after* `run`, so it is the
   * post-reorder hook and not a snapshot of the pre-reorder one.
   */
  const withHook = async (
    initialPhotos: ArtworkPhoto[],
    run: (photos: UseArtworkPhotos) => Promise<void>,
  ): Promise<UseArtworkPhotos> => {
    let latest: UseArtworkPhotos | null = null;
    const Probe: React.FC = () => {
      const photos = useArtworkPhotos({ initialPhotos });
      useEffect(() => {
        latest = photos;
      }, [photos]);
      return null;
    };
    render(
      <MantineProvider>
        <Probe />
      </MantineProvider>,
    );
    // The mount-time probe is a state update a tick after render; settling it
    // first keeps `addFiles` from racing the effect above.
    await waitFor(() => {
      expect(latest).not.toBeNull();
      expect(variantFormatIsWebp).toHaveBeenCalled();
    });
    await run(latest as UseArtworkPhotos);
    return latest as UseArtworkPhotos;
  };

  it("keeps a newly added photo where the user put it", async () => {
    const photos = await withHook(
      [photo("a", 0, "a.jpg"), photo("c", 1, "c.jpg")],
      async (hook) => {
        await act(async () => {
          await hook.addFiles([jpegFile("b.jpg")]);
        });
        // Added at the end, then dragged into the middle. The middle is the
        // case that matters: promoting to the front happens to agree with
        // "uploads first", so testing only that would pass against the very
        // bug this is for.
        act(() => {
          hook.reorder(2, 1);
        });
      },
    );

    const merged = photos.mergeUploaded([uploadedFor("b.jpg")]);

    expect(merged.map((entry) => entry.name)).toEqual([
      "a.jpg",
      "b.jpg",
      "c.jpg",
    ]);
  });

  it("leaves a photo alone when the user did not move it", async () => {
    const photos = await withHook([photo("a", 0, "a.jpg")], async (hook) => {
      await act(async () => {
        await hook.addFiles([jpegFile("b.jpg"), jpegFile("c.jpg")]);
      });
    });

    const merged = photos.mergeUploaded([
      uploadedFor("b.jpg"),
      uploadedFor("c.jpg"),
    ]);

    // The one place "uploads first" and "walk the list" agree: everything new
    // already follows everything stored. Worth pinning, because it is the case
    // a reader will assume is the general one.
    expect(merged.map((entry) => entry.name)).toEqual([
      "a.jpg",
      "b.jpg",
      "c.jpg",
    ]);
  });

  it("renumbers `order` to match the merged array", async () => {
    const photos = await withHook(
      [photo("a", 0, "a.jpg"), photo("c", 1, "c.jpg")],
      async (hook) => {
        await act(async () => {
          await hook.addFiles([jpegFile("b.jpg")]);
        });
        act(() => {
          hook.reorder(2, 1);
        });
      },
    );

    // `order` is rewritten from array position on every write precisely so it
    // cannot disagree with it. A stored photo that kept its old number here
    // would claim to be first while sitting second — the silent half of the
    // invariant, and the half that has no other check.
    const merged = photos.mergeUploaded([uploadedFor("b.jpg")]);

    expect(merged.map((entry) => entry.order)).toEqual([0, 1, 2]);
    expect(merged.map((entry) => entry.name)).toEqual([
      "a.jpg",
      "b.jpg",
      "c.jpg",
    ]);
  });
});

describe("the format the variants will be stored in", () => {
  const jpegWarning = () =>
    screen.queryByText(/will store jpeg instead of webp/i);

  it("warns when the browser cannot encode WebP", async () => {
    vi.mocked(variantFormatIsWebp).mockResolvedValue(false);
    await renderHarness();

    expect(
      await screen.findByText(/will store jpeg instead of webp/i),
    ).toBeInTheDocument();
  });

  it("says nothing when WebP is available", async () => {
    await renderHarness();

    // Wait for the probe to answer, so a warning appearing later would fail
    // this rather than merely go unnoticed.
    await waitFor(() => {
      expect(variantFormatIsWebp).toHaveBeenCalled();
    });
    expect(jpegWarning()).not.toBeInTheDocument();
  });

  it("believes the encoder over the probe", async () => {
    // The probe is a guess about a canvas made before any image exists. The
    // batch that actually produced the bytes is the fact, and it has to be
    // able to overrule the guess — a probe that says WebP while every variant
    // comes back JPEG is precisely how this went wrong unnoticed.
    vi.mocked(variantFormatIsWebp).mockResolvedValue(true);
    vi.mocked(processImages).mockImplementation((files: File[]) =>
      Promise.resolve(
        files.map((file) => ({
          file,
          webp: false,
          width: 2000,
          height: 1500,
          variants: [
            {
              key: "square_lg" as const,
              blob: new Blob([new Uint8Array([9])], { type: "image/jpeg" }),
              width: 800,
              height: 800,
              contentType: "image/jpeg",
            },
          ],
        })),
      ),
    );
    const user = userEvent.setup();
    await renderHarness();

    await user.upload(fileInput(), jpegFile("scan.jpg"));

    expect(
      await screen.findByText(/will store jpeg instead of webp/i),
    ).toBeInTheDocument();
  });
});
