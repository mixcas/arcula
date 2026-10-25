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
  Paper,
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
import { buildCollectionPdfPlan } from "./collectionPdfPlan";
import { collectionPdfFileName } from "./collectionPdfPreflight";
import { exportCollection } from "./exportCollection";
import { isAbortError } from "./photoPipeline";

interface ExportData {
  collection: Collection;
  artworks: Artwork[];
}

type LoadState = PublicState<ExportData>;

type Run =
  | { forKey: string; status: "idle" }
  | { forKey: string; status: "generating" }
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

  // A load carries the id it answered for: navigating to another Collection
  // renders `loading` immediately rather than briefly exporting the old one.
  const state: LoadState = useMemo(
    () => (load.id === collectionId ? load.state : { status: "loading" }),
    [load, collectionId],
  );

  const urlRef = useRef<string | null>(null);
  const autoStartedRef = useRef<string | null>(null);
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

  const reload = useCallback(() => {
    exportIdRef.current += 1;
    abortRun();
    revokeUrl();
    setLoad({ id: collectionId, state: { status: "loading" } });
    setAttempt((value) => value + 1);
  }, [collectionId, abortRun, revokeUrl]);

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

  // A new collection drops the previous document and its URL.
  useEffect(() => {
    exportIdRef.current += 1;
    abortRun();
    revokeUrl();
  }, [collectionId, abortRun, revokeUrl]);

  // The viewer's own unmount is the last place the blob URL can be released.
  useEffect(
    () => () => {
      exportIdRef.current += 1;
      abortRun();
      revokeUrl();
    },
    [abortRun, revokeUrl],
  );

  const startExport = useCallback(() => {
    if (state.status !== "ready") {
      return;
    }
    exportIdRef.current += 1;
    const exportId = exportIdRef.current;
    const key = runKey;
    abortRun();
    revokeUrl();
    const controller = new AbortController();
    abortRef.current = controller;
    setRun({ forKey: key, status: "generating" });

    /** The run is over, however it ended: stop calling its controller "in flight". */
    const settle = () => {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    };

    void exportCollection(state.value.collection, state.value.artworks, {
      signal: controller.signal,
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
  }, [state, runKey, collectionId, abortRun, revokeUrl]);

  // Ready starts generation on its own. Deferred by a tick because starting
  // writes state, and React asks that an effect not do that synchronously.
  useEffect(() => {
    if (state.status !== "ready" || currentRun.status !== "idle") {
      return;
    }
    if (autoStartedRef.current === runKey) {
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

  const effectiveState: LoadState = collectionId
    ? state
    : { status: "invalid" };

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

  const { collection, artworks } = effectiveState.value;
  const plan = buildCollectionPdfPlan(artworks);
  const empty = plan.length === 1 && plan[0].kind === "empty";
  const fileName = collectionPdfFileName(collection.name);
  const done = currentRun.status === "done" ? currentRun : null;

  return (
    <Container size="lg" py="2rem">
      <Stack gap="lg">
        <div>
          <Title order={2}>{collection.name}</Title>
          <Text size="sm" c="dimmed">
            Collection PDF
          </Text>
        </div>

        {currentRun.status === "generating" ? (
          <Group justify="center" py="xl">
            <Loader />
            <Text>Building PDF…</Text>
          </Group>
        ) : null}

        {currentRun.status === "idle" ? (
          <Group>
            <Button onClick={startExport}>Generate PDF</Button>
          </Group>
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
    </Container>
  );
};

export default CollectionPdfPage;
