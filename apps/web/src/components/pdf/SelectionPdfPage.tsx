/**
 * The Selection PDF viewer.
 *
 * Public chrome, not a ProtectedRoute: the ordinary Selection read decides
 * access, exactly as the public Selection page does. The Selection is read
 * first — the lock only exists on that read — and its works only after it
 * succeeds; the lock screen restarts the whole load, and therefore the export,
 * after a successful unlock.
 *
 * Every state renders inside the app's authenticated shell with the viewer's
 * own bar in its header slot. The bar names the Selection and links its own
 * address, never the Catalogue's: the source Catalogue is a different gate,
 * often a private one.
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
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Container,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
} from "@mantine/core";

import { selectionService } from "@/services/selectionService";
import {
  parseId,
  selectionSlug,
  type Artwork,
  type SelectionPublicRead,
} from "@arcula/shared";

import LockScreen from "@/components/LockScreen";
import PublicStateMessage from "@/components/catalogue/PublicStateMessage";
import ManageLayout from "@/components/manage/layout/ManageLayout";
import { APP_HEADER_HEIGHT } from "@/components/layout/HeaderBar";
import CataloguePdfBar from "./CataloguePdfBar";
import PdfFileActions from "./PdfFileActions";
import {
  pdfFileSummary,
  selectionPdfBarView,
  type PdfBarRun,
} from "./pdfBarView";
import {
  publicSelectionFailure,
  type PublicSelectionState,
} from "@/components/catalogue/usePublicSelection";
import { CataloguePdfAccessError } from "./cataloguePdfAccess";
import { photoPageCount } from "./cataloguePdfPlan";
import { buildSelectionPdfPlan } from "./selectionPdfPlan";
import {
  selectionPdfFileName,
  shouldWarnForLargeExport,
} from "./cataloguePdfPreflight";
import { exportSelection } from "./selectionPdfExport";
import { isAbortError, scheduledPhotos } from "./photoPipeline";

interface ExportData {
  /** The public read: the Selection's own name and the source presentation. */
  selection: SelectionPublicRead;
  /** Its works, in the curator's order, Drafts included. */
  artworks: Artwork[];
}

type LoadState = PublicSelectionState<ExportData>;

/**
 * The export's own state: `PdfBarRun` plus the key that ties a run to the read
 * it was started from, so a reload or a new Selection starts from idle.
 */
type Run = PdfBarRun & { forKey: string };

const readSelection = async (selectionId: string): Promise<LoadState> => {
  const selection = await selectionService.getPublicSelection(selectionId);
  if (selection === null) {
    return { status: "notFound" };
  }
  // The works come second: the Selection's own read is what refuses a private
  // one or challenges a protected one, so a refused Selection never issues it.
  // The one ordered read keeps Drafts and the curator's order, and its photo
  // URLs carry the `selection` scope a Draft's bytes need.
  const artworks = await selectionService.getWorks(selectionId);
  return { status: "ready", value: { selection, artworks } };
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

/**
 * The floor a short window keeps: the preview never collapses to a strip, even
 * where the window is smaller than the document would like.
 */
const PREVIEW_MIN_HEIGHT = 360;

/**
 * The preview's height: the window less the fixed bar and the body's own
 * padding, so the page itself does not scroll and the document scrolls inside
 * its frame. Both numbers come from the shell — `APP_HEADER_HEIGHT` and the
 * `AppShell`'s own padding variable — so no second 60 is written here.
 *
 * It is applied through `style`, never the `h` prop: Mantine parses style-prop
 * values and rewrites every number as a length, so it would mangle the `2 *`
 * product into an invalid `calc` and leave the frame at the iframe's default
 * height.
 */
const PREVIEW_HEIGHT = `max(${PREVIEW_MIN_HEIGHT}px, calc(100dvh - ${APP_HEADER_HEIGHT}px - 2 * var(--app-shell-padding)))`;

const SelectionPdfPage: React.FC = () => {
  const { selectionId: param } = useParams<{ selectionId: string }>();
  // Same `{slug}-{id}` or bare id parameter the public Selection page reads.
  const selectionId = parseId(param ?? "");
  const navigate = useNavigate();
  const mobile = useMobileLayout();

  const [load, setLoad] = useState<{
    id: string;
    state: LoadState;
  }>({ id: selectionId, state: { status: "loading" } });
  const [attempt, setAttempt] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  /**
   * The run key whose large-export warning is open. Cancel or dismissal clears
   * it and starts nothing; Continue clears it and starts the ordinary export.
   */
  const [warningForKey, setWarningForKey] = useState<string | null>(null);

  // A load carries the id it answered for: navigating to another Selection
  // renders `loading` immediately rather than briefly exporting the old one.
  const state: LoadState = useMemo(
    () => (load.id === selectionId ? load.state : { status: "loading" }),
    [load, selectionId],
  );

  const urlRef = useRef<string | null>(null);
  const autoStartedRef = useRef<string | null>(null);
  /** A run whose large-export warning was answered; it is never asked twice. */
  const warningHandledRef = useRef<string | null>(null);
  /** Invalidates a result whose Selection, run or component has gone away. */
  const exportIdRef = useRef(0);
  /** The run in flight, so a reload or an unmount can abort it. */
  const abortRef = useRef<AbortController | null>(null);

  const runKey = `${selectionId}:${attempt}`;
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

  const discardRun = useCallback(() => {
    exportIdRef.current += 1;
    abortRun();
    revokeUrl();
  }, [abortRun, revokeUrl]);

  const reload = useCallback(() => {
    discardRun();
    setLoad({ id: selectionId, state: { status: "loading" } });
    setAttempt((value) => value + 1);
  }, [selectionId, discardRun]);

  // The usual load: Selection first, works only after it succeeds.
  useEffect(() => {
    if (!selectionId) {
      return;
    }
    let cancelled = false;
    const apply = (next: LoadState) => {
      if (!cancelled) {
        setLoad({ id: selectionId, state: next });
      }
    };
    void readSelection(selectionId).then(apply, (error: unknown) => {
      apply(publicSelectionFailure(error));
    });
    return () => {
      cancelled = true;
    };
  }, [selectionId, attempt]);

  // A new Selection drops the previous document, its URL and the run's
  // warning bookkeeping: the same route and id can be visited again later.
  useEffect(() => {
    autoStartedRef.current = null;
    warningHandledRef.current = null;
    discardRun();
  }, [selectionId, discardRun]);

  // The viewer's own unmount is the last place the blob URL can be released.
  useEffect(
    () => () => {
      discardRun();
    },
    [discardRun],
  );

  // The ordinary render state is the load's, unless the URL has no id at all.
  const effectiveState: LoadState = useMemo(
    () => (selectionId ? state : { status: "invalid" }),
    [selectionId, state],
  );
  // The plan is derived once here so the warning, the progress total and the
  // document all read the same pages. It is the curator's order, Drafts kept.
  const plan = useMemo(
    () =>
      buildSelectionPdfPlan(
        effectiveState.status === "ready" ? effectiveState.value.artworks : [],
      ),
    [effectiveState],
  );

  // The legible address, written only once the Selection is readable by this
  // caller: a private Selection's name must not reach the URL or history
  // before its body does. `replace` keeps Back pointing where the reader came
  // from.
  const ready = effectiveState.status === "ready" ? effectiveState.value : null;
  useEffect(() => {
    if (!param || !ready) {
      return;
    }
    const selection = ready.selection.selection;
    const canonical = selectionSlug(selection.name, selection.id);
    if (canonical === param) {
      return;
    }
    void navigate(`/selection/${canonical}/pdf`, { replace: true });
  }, [param, ready, navigate]);

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

    void exportSelection(state.value.selection, state.value.artworks, {
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
        if (error instanceof CataloguePdfAccessError) {
          // A photo was refused and the Selection no longer reads the same
          // way: the export stops where the reader's access stopped, and the
          // ordinary load takes over — never a document of placeholders.
          setRun(null);
          setLoad({ id: selectionId, state: error.state });
          return;
        }
        // The state below says only that it failed. Whatever threw is the
        // whole diagnosis, so it goes to the console rather than nowhere.
        console.error("the Selection PDF export failed", error);
        setRun({ forKey: key, status: "failed" });
      },
    );
  }, [state, effectiveState, plan, runKey, selectionId, discardRun]);

  /**
   * The one entry point the control, the Retry and the automatic start use.
   * The warning is asked here, before any prefetch, so a click during the tick
   * before auto-start cannot skip it.
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

  /** Cancel during preparing: abort the fetches and produce no file. */
  const cancelExport = useCallback(() => {
    discardRun();
    setRun({ forKey: runKey, status: "cancelled" });
  }, [runKey, discardRun]);

  // Ready starts generation on its own. The warning decision belongs to
  // `startExport`, so this only schedules the ordinary call.
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

  /**
   * The one shell every state renders in: the app's fixed header carrying the
   * viewer's bar, and a fluid body so each state's own container decides its
   * measure.
   */
  const shell = (body: React.ReactNode) => (
    <ManageLayout
      header={
        <CataloguePdfBar
          view={selectionPdfBarView(effectiveState, currentRun, mobile)}
          onCancel={cancelExport}
        />
      }
      containerProps={{ fluid: true }}
    >
      {body}
    </ManageLayout>
  );

  if (effectiveState.status === "locked") {
    return shell(
      <LockScreen
        noun="selection"
        name={effectiveState.selectionName}
        onUnlock={async (password) => {
          await selectionService.unlockSelection(selectionId, password);
          reload();
        }}
      />,
    );
  }

  if (effectiveState.status !== "ready") {
    return shell(
      <>
        <PublicStateMessage
          status={effectiveState.status}
          labels={{
            invalid: "That selection link is not valid.",
            error: "Could not load this selection. Try again.",
            private: "This selection is private.",
            notFound: "This selection is not available.",
          }}
        />
        {effectiveState.status === "error" ? (
          <Container size="xl">
            <Button variant="default" onClick={reload}>
              Retry
            </Button>
          </Container>
        ) : null}
      </>,
    );
  }

  const name = effectiveState.value.selection.selection.name;
  const empty = plan.length === 1 && plan[0].kind === "empty";
  const photoPages = photoPageCount(plan);
  const fileName = selectionPdfFileName(name);
  const done = currentRun.status === "done" ? currentRun : null;
  const warningOpen = warningForKey === runKey && currentRun.status === "idle";
  // An empty Selection's PDF is a header alone; the line that says why is the
  // same on both layouts, above the preview and inside the card.
  const emptyNotice = empty ? (
    <Text size="sm" c="dimmed">
      This selection has no works.
    </Text>
  ) : null;

  return shell(
    <Container>
      <Stack gap="lg">
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
          mobile ? (
            <Paper withBorder p="lg">
              <Stack gap="md" align="flex-start">
                <Text fw={500}>Your PDF is ready.</Text>
                <Text size="sm" c="dimmed">
                  {pdfFileSummary(done.pages, done.size)}
                </Text>
                {emptyNotice}
                <PdfFileActions url={done.url} fileName={fileName} />
              </Stack>
            </Paper>
          ) : (
            <Stack gap="xs" style={{ height: PREVIEW_HEIGHT }}>
              {emptyNotice}
              <iframe
                title="Selection PDF"
                src={done.url}
                style={{
                  flex: 1,
                  minHeight: 0,
                  width: "100%",
                  border: "1px solid var(--mantine-color-gray-3)",
                  borderRadius: 4,
                }}
              />
            </Stack>
          )
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
    </Container>,
  );
};

export default SelectionPdfPage;
