/**
 * The Collection PDF viewer.
 *
 * Public chrome, not a ProtectedRoute: the two ordinary reads decide access,
 * exactly as the public Collection page does. The Collection is read first,
 * the Artwork list only after it succeeds, and the lock screen restarts the
 * whole load — and therefore the export — after a successful unlock.
 *
 * The renderer is behind this lazy route (`App.tsx`), so it is a separate
 * chunk; nothing here imports a page that does not need it.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import {
  Button,
  Container,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconDownload, IconExternalLink } from "@tabler/icons-react";

import { artworkService } from "@/services/artworkService";
import { collectionService } from "@/services/collectionService";
import { parseId, type Artwork, type Collection } from "@arcula/shared";

import CollectionLockScreen from "@/components/collection/CollectionLockScreen";
import PublicStateMessage from "@/components/collection/PublicStateMessage";
import {
  publicFailure,
  type PublicState,
} from "@/components/collection/usePublicCollection";
import { CollectionPdfAccessError } from "./collectionPdfAccess";
import { buildCollectionPdfPlan, photoPageCount } from "./collectionPdfPlan";
import {
  collectionPdfFileName,
  shouldWarnForLargeExport,
} from "./collectionPdfPreflight";
import { exportCollection } from "./exportCollection";
import { isAbortError, scheduledPhotos } from "./photoPipeline";

interface ExportData {
  collection: Collection;
  artworks: Artwork[];
}

type LoadState = PublicState<ExportData>;

type Run =
  | { forKey: string; status: "idle" }
  | {
      forKey: string;
      status: "preparing";
      done: number;
      total: number;
    }
  | { forKey: string; status: "rendering" }
  | { forKey: string; status: "cancelled" }
  | { forKey: string; status: "failed" }
  | {
      forKey: string;
      status: "done";
      url: string;
      pages: number;
      size: number;
    };

const readCollection = async (collectionId: string): Promise<LoadState> => {
  const collection = await collectionService.getCollection(collectionId);
  if (collection === null) {
    return { status: "notFound" };
  }
  // One list route for both callers: a member's answer includes drafts, a
  // visitor's is published-only. The page plan filters to published, live
  // works again either way.
  const artworks = await artworkService.getCollectionArtworks(collectionId);
  return { status: "ready", value: { collection, artworks } };
};

/** The two layout queries, used by the first read and by the subscription. */
const mobileQueries = (): MediaQueryList[] =>
  typeof window === "undefined" || !window.matchMedia
    ? []
    : [
        window.matchMedia("(pointer: coarse)"),
        window.matchMedia("(max-width: 700px)"),
      ];

const isMobileLayout = (): boolean =>
  mobileQueries().some((query) => query.matches);

const useMobileLayout = (): boolean => {
  const [mobile, setMobile] = useState(isMobileLayout);

  useEffect(() => {
    const queries = mobileQueries();
    if (queries.length === 0) {
      return;
    }
    const update = () => setMobile(queries.some((query) => query.matches));
    update();
    for (const query of queries) {
      query.addEventListener("change", update);
    }
    return () => {
      for (const query of queries) {
        query.removeEventListener("change", update);
      }
    };
  }, []);

  return mobile;
};

/**
 * `navigator.deviceMemory`, absent on Safari/iOS.
 *
 * The memory clause cannot gate a phone there — which is why the predicate has
 * a mobile-layout clause of its own — so this answers `undefined` rather than
 * an invented value.
 */
const readDeviceMemory = (): number | undefined => {
  const value = (navigator as Navigator & { deviceMemory?: unknown })
    .deviceMemory;
  return typeof value === "number" ? value : undefined;
};

const formatBytes = (bytes: number): string =>
  bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(2)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} kB`;

/** Download and Open PDF: the same two controls on desktop and mobile. */
const PdfActions: React.FC<{ url: string; fileName: string }> = ({
  url,
  fileName,
}) => (
  <Group>
    <Button
      component="a"
      href={url}
      download={fileName}
      leftSection={<IconDownload size={16} />}
    >
      Download
    </Button>
    <Button
      variant="light"
      leftSection={<IconExternalLink size={16} />}
      onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
    >
      Open PDF
    </Button>
  </Group>
);

const CollectionPdfPage: React.FC = () => {
  const { collectionId: param } = useParams<{ collectionId: string }>();
  // Same `{slug}-{id}` or bare id parameter the public Collection page reads.
  const collectionId = parseId(param ?? "");
  const mobile = useMobileLayout();

  const [load, setLoad] = useState<{
    id: string;
    state: LoadState;
  }>({ id: collectionId, state: { status: "loading" } });
  const [attempt, setAttempt] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  /**
   * The run key whose large-export warning is open. Cancel or dismissal clears
   * it and starts nothing; Continue clears it and starts the ordinary export.
   */
  const [warningForKey, setWarningForKey] = useState<string | null>(null);

  // A load carries the id it answered for: navigating to another Collection
  // renders `loading` immediately rather than briefly exporting the old one.
  const state: LoadState = useMemo(
    () => (load.id === collectionId ? load.state : { status: "loading" }),
    [load, collectionId],
  );

  const urlRef = useRef<string | null>(null);
  const autoStartedRef = useRef<string | null>(null);
  /** A run whose large-export warning was answered; it is never asked twice. */
  const warningHandledRef = useRef<string | null>(null);
  /** Invalidates a result whose collection, run or component has gone away. */
  const exportIdRef = useRef(0);
  /** The run in flight, so a reload or an unmount can abort it. */
  const abortRef = useRef<AbortController | null>(null);

  const runKey = `${collectionId}:${attempt}`;
  const currentRun: Run =
    run && run.forKey === runKey ? run : { forKey: runKey, status: "idle" };

  const revokeUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  // Aborting is what releases an in-flight export's fetched photos: the
  // pipeline drops a cancelled conversion instead of encoding it.
  const abortRun = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // A cancel, a reload, a new collection or an unmount all end a run the same
  // way: invalidate its result, abort its fetches and release its file. The
  // export id is bumped first so the rejected run lands nowhere.
  const discardRun = useCallback(() => {
    exportIdRef.current += 1;
    abortRun();
    revokeUrl();
  }, [abortRun, revokeUrl]);

  const reload = useCallback(() => {
    discardRun();
    setLoad({ id: collectionId, state: { status: "loading" } });
    setAttempt((value) => value + 1);
  }, [collectionId, discardRun]);

  // The usual load: Collection first, Artwork list only after it succeeds.
  useEffect(() => {
    if (!collectionId) {
      return;
    }
    let cancelled = false;
    const apply = (next: LoadState) => {
      if (!cancelled) {
        setLoad({ id: collectionId, state: next });
      }
    };
    void readCollection(collectionId).then(apply, (error: unknown) => {
      apply(publicFailure(error));
    });
    return () => {
      cancelled = true;
    };
  }, [collectionId, attempt]);

  // A new collection drops the previous document, its URL and the run's
  // warning bookkeeping: the same route and id can be visited again later.
  useEffect(() => {
    autoStartedRef.current = null;
    warningHandledRef.current = null;
    discardRun();
  }, [collectionId, discardRun]);

  // The viewer's own unmount is the last place the blob URL can be released.
  useEffect(
    () => () => {
      discardRun();
    },
    [discardRun],
  );

  // The ordinary render state is the load's, unless the URL has no id at all.
  // The plan is derived once here so the warning, the progress total and the
  // document all read the same pages.
  const effectiveState: LoadState = useMemo(
    () => (collectionId ? state : { status: "invalid" }),
    [collectionId, state],
  );
  const plan = useMemo(
    () =>
      buildCollectionPdfPlan(
        effectiveState.status === "ready" ? effectiveState.value.artworks : [],
      ),
    [effectiveState],
  );

  const beginExport = useCallback(() => {
    if (state.status !== "ready" || effectiveState.status !== "ready") {
      return;
    }
    discardRun();
    const exportId = exportIdRef.current;
    const key = runKey;
    const controller = new AbortController();
    abortRef.current = controller;

    // A no-photo export has no progress to show: it goes straight to the
    // renderer, never through a `0 of 0` frame.
    const total = scheduledPhotos(plan).length;
    setRun(
      total === 0
        ? { forKey: key, status: "rendering" }
        : { forKey: key, status: "preparing", done: 0, total },
    );

    /** The run is over, however it ended: stop calling its controller "in flight". */
    const settle = () => {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    };

    void exportCollection(state.value.collection, state.value.artworks, {
      signal: controller.signal,
      onProgress: (done, total) => {
        if (exportIdRef.current !== exportId) {
          return;
        }
        setRun({ forKey: key, status: "preparing", done, total });
      },
      // The renderer is atomic and cannot be interrupted: from here the
      // viewer's Cancel is disabled.
      onRendering: () => {
        if (exportIdRef.current !== exportId) {
          return;
        }
        setRun({ forKey: key, status: "rendering" });
      },
    }).then(
      (result) => {
        settle();
        if (exportIdRef.current !== exportId) {
          return;
        }
        const url = URL.createObjectURL(result.blob);
        urlRef.current = url;
        setRun({
          forKey: key,
          status: "done",
          url,
          pages: result.pages,
          size: result.blob.size,
        });
      },
      (error: unknown) => {
        settle();
        if (exportIdRef.current !== exportId || isAbortError(error)) {
          return;
        }
        if (error instanceof CollectionPdfAccessError) {
          // A photo was refused and the Collection no longer reads the same
          // way: the export stops where the reader's access stopped, and the
          // ordinary load takes over — never a document of placeholders.
          // Unlocking re-runs the load and this export from the beginning.
          setRun(null);
          setLoad({ id: collectionId, state: error.state });
          return;
        }
        // The state below says only that it failed. Whatever threw is the
        // whole diagnosis, so it goes to the console rather than nowhere: the
        // first bug this shipped with was invisible for exactly this reason.
        console.error("the Collection PDF export failed", error);
        setRun({ forKey: key, status: "failed" });
      },
    );
  }, [state, effectiveState, plan, runKey, collectionId, discardRun]);

  /**
   * The one entry point the control, the Retry and the automatic start use.
   *
   * The warning is asked here, before any prefetch — not only on the automatic
   * path — so a click on Generate PDF during the tick before auto-start cannot
   * skip a warning. A warning already open is never bypassed; Continue is the
   * only way past it, and it calls `beginExport` directly.
   */
  const startExport = useCallback(() => {
    if (state.status !== "ready" || warningForKey === runKey) {
      return;
    }
    if (
      warningHandledRef.current !== runKey &&
      shouldWarnForLargeExport(photoPageCount(plan), readDeviceMemory(), mobile)
    ) {
      setWarningForKey(runKey);
      return;
    }
    beginExport();
  }, [state, warningForKey, runKey, plan, mobile, beginExport]);

  /**
   * Cancel during preparing: abort the fetches, drop every converted photo and
   * produce no file. Bumping the export id is what makes the aborted run's
   * rejection land nowhere instead of overwriting this state.
   */
  const cancelExport = useCallback(() => {
    discardRun();
    setRun({ forKey: runKey, status: "cancelled" });
  }, [runKey, discardRun]);

  // Ready starts generation on its own. The warning decision belongs to
  // `startExport`, so this only schedules the ordinary call; a dismissed
  // warning is remembered and leaves the viewer idle with Generate PDF.
  useEffect(() => {
    if (state.status !== "ready" || currentRun.status !== "idle") {
      return;
    }
    if (autoStartedRef.current === runKey) {
      return;
    }
    if (warningHandledRef.current === runKey) {
      return;
    }
    autoStartedRef.current = runKey;

    const timer = window.setTimeout(() => {
      startExport();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      autoStartedRef.current = null;
    };
  }, [state, currentRun.status, runKey, startExport]);

  const dismissWarning = useCallback(() => {
    warningHandledRef.current = runKey;
    setWarningForKey(null);
  }, [runKey]);

  const continueAfterWarning = useCallback(() => {
    warningHandledRef.current = runKey;
    setWarningForKey(null);
    beginExport();
  }, [runKey, beginExport]);

  if (effectiveState.status === "locked") {
    return (
      <CollectionLockScreen
        collectionId={collectionId}
        collectionName={effectiveState.collectionName}
        onUnlocked={reload}
      />
    );
  }

  if (effectiveState.status !== "ready") {
    return (
      <>
        <PublicStateMessage status={effectiveState.status} />
        {effectiveState.status === "error" ? (
          <Container size="xl">
            <Button variant="default" onClick={reload}>
              Retry
            </Button>
          </Container>
        ) : null}
      </>
    );
  }

  const { collection } = effectiveState.value;
  const empty = plan.length === 1 && plan[0].kind === "empty";
  const photoPages = photoPageCount(plan);
  const fileName = collectionPdfFileName(collection.name);
  const done = currentRun.status === "done" ? currentRun : null;
  const warningOpen = warningForKey === runKey && currentRun.status === "idle";

  return (
    <Container size="lg" py="2rem">
      <Stack gap="lg">
        <div>
          <Title order={2}>{collection.name}</Title>
          <Text size="sm" c="dimmed">
            Collection PDF
          </Text>
        </div>

        {currentRun.status === "preparing" ? (
          <Stack gap="sm">
            <Progress
              value={
                currentRun.total === 0
                  ? 0
                  : (currentRun.done / currentRun.total) * 100
              }
            />
            <Group justify="space-between">
              <Text>
                Preparing photos {currentRun.done} of {currentRun.total}
              </Text>
              <Button variant="default" onClick={cancelExport}>
                Cancel
              </Button>
            </Group>
          </Stack>
        ) : null}

        {currentRun.status === "rendering" ? (
          <Group justify="space-between">
            <Group>
              <Loader />
              <Text>Building PDF…</Text>
            </Group>
            {/* The renderer is atomic: there is nothing to cancel that would
                not leave a half-built document. */}
            <Button variant="default" disabled>
              Cancel
            </Button>
          </Group>
        ) : null}

        {currentRun.status === "idle" ? (
          <Group>
            <Button onClick={startExport}>Generate PDF</Button>
          </Group>
        ) : null}

        {currentRun.status === "cancelled" ? (
          <Stack gap="sm" align="flex-start">
            <Text>Export cancelled.</Text>
            <Button onClick={startExport}>Generate PDF</Button>
          </Stack>
        ) : null}

        {currentRun.status === "failed" ? (
          <Stack gap="sm" align="flex-start">
            <Text>The PDF could not be generated.</Text>
            <Button onClick={startExport}>Retry</Button>
          </Stack>
        ) : null}

        {done ? (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {done.pages} pages · {formatBytes(done.size)}
            </Text>

            {empty ? (
              <Text>This collection has no published artworks.</Text>
            ) : null}

            {mobile ? (
              <Paper withBorder p="lg">
                <Stack gap="md" align="flex-start">
                  <Text fw={500}>Your PDF is ready.</Text>
                  <PdfActions url={done.url} fileName={fileName} />
                </Stack>
              </Paper>
            ) : (
              <>
                <PdfActions url={done.url} fileName={fileName} />
                <iframe
                  title="Collection PDF"
                  src={done.url}
                  style={{
                    width: "100%",
                    height: "80vh",
                    border: "1px solid var(--mantine-color-gray-3)",
                    borderRadius: 4,
                  }}
                />
              </>
            )}
          </Stack>
        ) : null}
      </Stack>

      <Modal
        opened={warningOpen}
        onClose={dismissWarning}
        title="Large export"
        centered
      >
        <Stack gap="md">
          <Text>
            This export has {photoPages} photo pages at 300 dpi and can use a
            lot of memory on a small device.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={dismissWarning}>
              Cancel
            </Button>
            <Button onClick={continueAfterWarning}>Continue</Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
};

export default CollectionPdfPage;
