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
import { mediaService } from "@/services/mediaService";
import { ApiRequestError } from "@/services/api";
import { MAX_ARTWORK_PHOTOS } from "@arcula/shared";
import type { ArtworkPhoto } from "@arcula/shared";

/**
 * The staging boundary: the form never decodes or resizes a byte, so every
 * pixel assertion here reads the server's own answer back through the mock
 * rather than emulating an encoder. The geometry and the encoder are the
 * API's, and the API suite pins them.
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

const COLLECTION_ID = "collection-1";
const ARTWORK_ID = "artwork-1";

// `useModals` throws without a provider. Rendered anyway so adding a modal
// later cannot silently break these tests.
const Harness: React.FC<{ initialPhotos?: ArtworkPhoto[] }> = ({
  initialPhotos,
}) => {
  const photos = useArtworkPhotos({
    collectionId: COLLECTION_ID,
    artworkId: ARTWORK_ID,
    initialPhotos,
  });
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

const renderHarness = async (initialPhotos?: ArtworkPhoto[]) => {
  const result = render(<Harness initialPhotos={initialPhotos} />);
  await screen.findByText(/drag images here/i);
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

/**
 * Every entry id that passed through the stage mock, in arrival order.
 *
 * The ids are minted by the hook with `crypto.randomUUID`, so a test cannot
 * predict them; capturing them is what makes the discard assertions name the
 * exact object the server is being asked to drop.
 */
let stagedEntryIds: string[];

beforeEach(() => {
  stagedEntryIds = [];

  vi.mocked(mediaService.stagePhoto).mockImplementation(
    (_cid, _aid, entryId, file) => {
      stagedEntryIds.push(entryId);
      return Promise.resolve({
        entryId,
        name: file.name,
        width: 2000,
        height: 1500,
        size: file.size,
        contentType: file.type,
        url: `https://media.test/staging/${entryId}/original`,
      });
    },
  );
  // The two variants the form actually renders: `square_lg` for the tile,
  // `large` for the preview modal. Named urls, not blobs — there is no
  // object-URL lifecycle left to test against.
  vi.mocked(mediaService.processPhoto).mockImplementation(
    (_cid, _aid, entryId) =>
      Promise.resolve({
        entryId,
        variants: [
          {
            key: "square_lg",
            url: `https://media.test/variants/${entryId}/square_lg.webp`,
            width: 800,
            height: 800,
            size: 100,
            contentType: "image/webp",
          },
          {
            key: "large",
            url: `https://media.test/variants/${entryId}/large.webp`,
            width: 1200,
            height: 900,
            size: 200,
            contentType: "image/webp",
          },
        ],
      }),
  );
  vi.mocked(mediaService.discardPhoto).mockResolvedValue(undefined);
});

afterEach(() => {
  // vitest.config.ts deliberately does not set `globals`, so Testing Library's
  // automatic cleanup never registers. Without this each render stays in the
  // document and the next test's queries match the previous test's tiles.
  cleanup();
  vi.clearAllMocks();
});

describe("PhotoUploader", () => {
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

  it("removes a stored photo without touching staging", async () => {
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
    // Nothing was ever PUT for a stored photo, so there is nothing to discard:
    // the save's PATCH omits the id and the server sweeps the objects.
    expect(mediaService.discardPhoto).not.toHaveBeenCalled();
  });

  it("renders a staged photo from the server's variant urls", async () => {
    const user = userEvent.setup();
    await renderHarness();

    await user.upload(fileInput(), jpegFile("scan.jpg"));

    const tile = await screen.findByRole("img", { name: "scan.jpg" });
    // The entry id the hook minted is the one the urls are built from: this
    // assertion reads the server's own answer back, which is the whole point
    // of staging at add time. A blob url here would be the old pipeline.
    expect(tile).toHaveAttribute(
      "src",
      `https://media.test/variants/${stagedEntryIds[0]}/square_lg.webp`,
    );
  });

  it("keeps the rest of a mixed drop and says why the other was refused", async () => {
    await renderHarness();
    // Delivered the way the OS delivers it: both files on one change event,
    // whatever the `accept` hint said. `userEvent.upload` cannot do this —
    // it honours the `accept` attribute like the picker does, and would
    // quietly drop the PDF before the event ever fired.
    const input = fileInput();
    Object.defineProperty(input, "files", {
      value: [
        jpegFile("good.jpg"),
        new File([new Uint8Array([1])], "notes.pdf", {
          type: "application/pdf",
        }),
      ],
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await waitFor(() => {
      expect(screen.getByText("good.jpg")).toBeInTheDocument();
    });
    // The PDF never reaches the hook: the Dropzone's own validator refuses it
    // on the way in and routes it through the reject handler, which folds the
    // library's reason into the same alert. Asserted by prefix, not by the
    // library's copy: the contract is that the file is named and explained,
    // and the wording belongs to the Dropzone.
    expect(screen.getByText("1 image could not be added")).toBeInTheDocument();
    expect(screen.getByText(/^notes\.pdf: /)).toBeInTheDocument();
    expect(screen.queryByText(/^notes\.pdf$/)).toBeNull();
  });

  it("keeps the validator's reason when the hook refuses another in the same drop", async () => {
    // The two rejection paths fire in one drop here, and they are not the same
    // tick: the Dropzone's validator refuses the PDF synchronously, and the
    // hook's refusal of the JPEG settles with the staging a moment later. The
    // later list must be appended to the earlier one — a replacement erases the
    // PDF's line, which is a message the user only ever sees go missing, so it
    // is pinned rather than assumed.
    vi.mocked(mediaService.stagePhoto).mockRejectedValue(
      new ApiRequestError(400, "tooMany", "The file is too large", {
        file: "The file is over 10 MB",
      }),
    );
    await renderHarness();

    const input = fileInput();
    Object.defineProperty(input, "files", {
      value: [
        jpegFile("scan.jpg"),
        new File([new Uint8Array([1])], "notes.pdf", {
          type: "application/pdf",
        }),
      ],
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await waitFor(() => {
      expect(
        screen.getByText("2 images could not be added"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/^notes\.pdf: /)).toBeInTheDocument();
    expect(
      screen.getByText("scan.jpg: The file is over 10 MB"),
    ).toBeInTheDocument();
  });

  it("surfaces the stage route's refusal with its own reason", async () => {
    // The size cap is the route's to answer, and its envelope carries the
    // prose: `fields.file` is the field-level message the form should show,
    // and `message` is the fallback when there is none.
    vi.mocked(mediaService.stagePhoto).mockRejectedValue(
      new ApiRequestError(400, "tooMany", "The file is too large", {
        file: "The file is over 10 MB",
      }),
    );
    const user = userEvent.setup();
    await renderHarness();

    await user.upload(fileInput(), jpegFile("scan.jpg"));

    await waitFor(() => {
      expect(
        screen.getByText("scan.jpg: The file is over 10 MB"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("img", { name: "scan.jpg" })).toBeNull();
  });

  it("discards the staged original when the variants fail", async () => {
    // The original is up and no save will ever name it: without the discard it
    // lingers until the sweep, and a failed batch would leave objects behind
    // per photo.
    vi.mocked(mediaService.processPhoto).mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    await renderHarness();

    await user.upload(fileInput(), jpegFile("scan.jpg"));

    expect(
      await screen.findByText("scan.jpg: The image could not be uploaded"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(mediaService.discardPhoto).toHaveBeenCalledTimes(1);
    });
    expect(mediaService.discardPhoto).toHaveBeenCalledWith(
      COLLECTION_ID,
      ARTWORK_ID,
      stagedEntryIds[0],
    );
  });

  it("discards a staged photo when it is removed", async () => {
    const user = userEvent.setup();
    await renderHarness();

    await user.upload(fileInput(), jpegFile("scan.jpg"));
    const entryId = stagedEntryIds[0];
    const remove = await screen.findByRole("button", { name: /remove image/i });
    await user.click(remove);

    await waitFor(() => {
      expect(screen.queryByText("scan.jpg")).not.toBeInTheDocument();
    });
    // Fire-and-forget, so await the assertion rather than the call.
    await waitFor(() => {
      expect(mediaService.discardPhoto).toHaveBeenCalledWith(
        COLLECTION_ID,
        ARTWORK_ID,
        entryId,
      );
    });
  });

  it("previews a staged photo through the same ladder as a stored one", async () => {
    const user = userEvent.setup();
    await renderHarness();

    await user.upload(fileInput(), jpegFile("scan.jpg"));
    await user.click(await screen.findByRole("img", { name: "scan.jpg" }));

    const dialog = await screen.findByRole("dialog");
    // The `large` variant the modal wants — the server's url for it, the same
    // ladder a stored photo walks.
    expect(
      within(dialog).getByRole("img", { name: "scan.jpg" }).getAttribute("src"),
    ).toBe(`https://media.test/variants/${stagedEntryIds[0]}/large.webp`);
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
});

/**
 * Renders the hook alone, for the assertions that are about the hook's
 * decisions rather than about the grid.
 *
 * `commit` is what the page calls and no rendering of the form ever shows its
 * result — the bug it guards was invisible until the artwork was read back.
 *
 * The hook is handed back through an effect rather than assigned during render
 * — React's rules are right that reassigning a variable from outside the
 * component is a side effect, and a test only needs the value a tick later
 * anyway. The returned value is read *after* `run`, so it is the post-action
 * hook and not a snapshot of the pre-action one.
 */
const withHook = async (
  initialPhotos: ArtworkPhoto[],
  run: (photos: UseArtworkPhotos) => Promise<void>,
): Promise<UseArtworkPhotos> => {
  let latest: UseArtworkPhotos | null = null;
  const Probe: React.FC = () => {
    const photos = useArtworkPhotos({
      collectionId: COLLECTION_ID,
      artworkId: ARTWORK_ID,
      initialPhotos,
    });
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
  await waitFor(() => {
    expect(latest).not.toBeNull();
  });
  await run(latest as UseArtworkPhotos);
  return latest as UseArtworkPhotos;
};

/**
 * The order the user set has to survive the save.
 *
 * `commit` answers the sequence of entry ids in array order — the server
 * numbers them from position at save, which is the reindex the old
 * `reindexPhotos` did on the client. So the payload carries ids and names
 * only, and a sequence that disagrees with the working list's order is a
 * drag discarded behind a success toast.
 */
describe("commit", () => {
  it("leaves the field out of a save when nothing changed", async () => {
    // The reason the method exists: a save that only touched the title must
    // not rewrite the sequence for nothing.
    const photos = await withHook(
      [photo("a", 0, "a.jpg"), photo("b", 1, "b.jpg")],
      () => {},
    );

    expect(photos.commit()).toBeNull();
  });

  it("sends the new sequence when a photo is dragged", async () => {
    // The case this whole comparison exists for. Same two photos, same ids,
    // different sequence — which is exactly what the documents' *set*
    // comparison is blind to. Reordering the photo list is the one thing this
    // form exists to let someone do, so a commit that read the order as a set
    // would discard the drag on save and report success.
    const photos = await withHook(
      [photo("a", 0, "a.jpg"), photo("b", 1, "b.jpg")],
      (hook) => {
        act(() => {
          hook.reorder(1, 0);
        });
      },
    );

    const committed = photos.commit();
    expect(committed?.map((entry) => entry.entryId)).toEqual(["b", "a"]);
    expect(committed?.map((entry) => entry.name)).toEqual(["b.jpg", "a.jpg"]);
  });

  it("sends the shorter sequence when a photo is removed", async () => {
    const photos = await withHook(
      [photo("a", 0, "a.jpg"), photo("b", 1, "b.jpg")],
      (hook) => {
        act(() => {
          hook.remove(hook.entries[0].key);
        });
      },
    );

    expect(photos.commit()?.map((entry) => entry.entryId)).toEqual(["b"]);
  });

  it("carries staged additions in array position", async () => {
    // A staged entry takes its slot where the user put it, with the entry id
    // the hook staged it under — the save's transaction promotes that exact
    // object.
    const photos = await withHook([photo("a", 0, "a.jpg")], async (hook) => {
      await act(async () => {
        await hook.addFiles([jpegFile("b.jpg")]);
      });
    });

    const committed = photos.commit();
    expect(committed?.map((entry) => entry.entryId)).toEqual([
      "a",
      stagedEntryIds[0],
    ]);
    expect(committed?.map((entry) => entry.name)).toEqual(["a.jpg", "b.jpg"]);
  });
});

describe("addFiles", () => {
  it("refuses a type the allowlist does not admit, without staging", async () => {
    // The DOM path never reaches this check — the Dropzone's own validator
    // refuses non-images on the way in — but `addFiles` is the boundary for
    // any caller that bypasses it, and a file that stages and then fails the
    // route's own type check costs an object the sweep has to clean.
    const photos = await withHook([], async (hook) => {
      await act(async () => {
        const result = await hook.addFiles([
          new File([new Uint8Array([1])], "notes.pdf", {
            type: "application/pdf",
          }),
        ]);
        expect(result.added).toHaveLength(0);
        expect(result.rejected.map((entry) => entry.reason)).toEqual([
          "Not a supported image",
        ]);
      });
    });

    expect(photos.entries).toHaveLength(0);
    expect(mediaService.stagePhoto).not.toHaveBeenCalled();
  });

  it("refuses over the cap without staging anything", async () => {
    // The cap is enforced before any round trip, so the refusal carries the
    // form's own reason rather than the route's, and the stage mock never
    // hears about the drop at all.
    const seeded = Array.from({ length: MAX_ARTWORK_PHOTOS }, (_, index) =>
      photo(`p${index}`, index),
    );
    const photos = await withHook(seeded, async (hook) => {
      await act(async () => {
        const result = await hook.addFiles([
          jpegFile("one.jpg"),
          jpegFile("two.jpg"),
        ]);
        expect(result.rejected.map((entry) => entry.reason)).toEqual([
          `Only ${MAX_ARTWORK_PHOTOS} images per artwork`,
          `Only ${MAX_ARTWORK_PHOTOS} images per artwork`,
        ]);
      });
    });

    expect(photos.entries).toHaveLength(MAX_ARTWORK_PHOTOS);
    expect(mediaService.stagePhoto).not.toHaveBeenCalled();
  });

  it("leaves no gap in the numbering when a file fails mid-batch", async () => {
    // The append numbers each success from `entries.length + added.length`, so
    // a failure in the middle must not open a hole: the second success still
    // numbers one after the first. A gap here would persist to the server's
    // reindex as a skip nobody can see.
    vi.mocked(mediaService.stagePhoto).mockImplementation(
      (_cid, _aid, entryId, file) => {
        if (file.name === "fail.jpg") {
          return Promise.reject(
            new ApiRequestError(400, "tooMany", "The file is too large"),
          );
        }
        stagedEntryIds.push(entryId);
        return Promise.resolve({
          entryId,
          name: file.name,
          width: 2000,
          height: 1500,
          size: file.size,
          contentType: file.type,
          url: `https://media.test/staging/${entryId}/original`,
        });
      },
    );
    const photos = await withHook(
      [photo("a", 0, "a.jpg"), photo("b", 1, "b.jpg")],
      async (hook) => {
        const result = await act(async () => {
          return await hook.addFiles([
            jpegFile("one.jpg"),
            jpegFile("fail.jpg"),
            jpegFile("two.jpg"),
          ]);
        });
        // `added` is the whole entry union here, so name each entry through
        // the arm it actually is — every entry in this batch is staged.
        expect(
          result.added.map((entry) =>
            entry.status === "staged" ? entry.preview.name : entry.photo.name,
          ),
        ).toEqual(["one.jpg", "two.jpg"]);
        expect(result.rejected.map((entry) => entry.reason)).toEqual([
          "The file is too large",
        ]);
      },
    );

    // `order` on a staged entry is its position in the working list: two
    // stored photos, then the two successes in drop order, no hole between.
    expect(
      photos.entries
        .slice(2)
        .map((entry) =>
          entry.status === "staged" ? entry.preview.order : null,
        ),
    ).toEqual([2, 3]);
  });
});
