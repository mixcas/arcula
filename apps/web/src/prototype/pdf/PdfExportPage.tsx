/**
 * PROTOTYPE — the Collection PDF viewer shell.
 *
 * Throwaway code on `prototype/pdf-export` (#129). One route
 * (`/collection/:collectionId/pdf`) that loads a collection the way the public
 * page does, lets the operator choose the open variables, prepares the photos
 * with progress and cancellation, renders the PDF once, and shows it in our own
 * iframe with a Download button and the mobile "Open PDF" path.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";
import {
  Alert,
  Anchor,
  Button,
  Container,
  Group,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconDownload, IconExternalLink, IconX } from "@tabler/icons-react";

import { buildPdfPlan, compareArtworks, isExportableArtwork } from "./plan";
import {
  exportCollection,
  GrantExpiredError,
  type ExportOptions,
  type ExportProgress,
  type ExportStats,
  type ImageSource,
} from "./exportCollection";
import type { PdfTypography } from "./CollectionPdf";
import { ExportAbortedError, PhotoUnavailableError } from "./photoToJpeg";
import { collectionService } from "@/services/collectionService";
import { artworkService } from "@/services/artworkService";
import { publicFailure } from "@/components/collection/usePublicCollection";
import type { PublicState } from "@/components/collection/usePublicCollection";
import CollectionLockScreen from "@/components/collection/CollectionLockScreen";
import PublicStateMessage from "@/components/collection/PublicStateMessage";
import type { Artwork, Collection } from "@arcula/shared";
import { parseId, urlizeName } from "@arcula/shared";

interface ExportData {
  collection: Collection;
  artworks: Artwork[];
}

type LoadState = PublicState<ExportData>;

type RunState =
  | { status: "idle" }
  | { status: "running"; progress: ExportProgress }
  | {
      status: "done";
      url: string;
      stats: ExportStats;
      options: ExportOptions;
      blob: Blob;
    }
  | { status: "cancelled" }
  | { status: "error"; message: string };

const LOAD = async (collectionId: string): Promise<LoadState> => {
  const collection = await collectionService.getCollection(collectionId);
  if (collection === null) {
    return { status: "notFound" };
  }
  // A member's list is every live work — drafts included — while a visitor's
  // is the published ones. The export filters to published either way.
  const artworks = await artworkService.getCollectionArtworks(collectionId);
  return { status: "ready", value: { collection, artworks } };
};

const DEFAULTS: ExportOptions = {
  source: "xlarge",
  dpi: 300,
  typography: "template",
  jpegQuality: 0.9,
};

/** Prototype ergonomics: the same knobs as the selects, from the URL, so a
 *  headless run can compare two exports without clicking. */
const optionsFromQuery = (): ExportOptions => {
  if (typeof window === "undefined") {
    return DEFAULTS;
  }
  const params = new URLSearchParams(window.location.search);
  const source = params.get("source");
  const dpi = Number(params.get("dpi"));
  const typography = params.get("typography");
  const quality = Number(params.get("quality"));
  return {
    source: source === "original" ? "original" : DEFAULTS.source,
    dpi: dpi === 150 || dpi === 200 || dpi === 300 ? dpi : DEFAULTS.dpi,
    typography:
      typography === "template" || typography === "compact"
        ? typography
        : DEFAULTS.typography,
    jpegQuality:
      quality === 0.8 || quality === 0.95 ? quality : DEFAULTS.jpegQuality,
  };
};

const isCoarsePointer = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(max-width: 700px)").matches
  );
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
};

export interface PrototypeWindow {
  blob?: Blob;
  url?: string;
  stats?: ExportStats;
  options?: ExportOptions;
}

const windowWithPrototype = (): Window & { __pdfExport?: PrototypeWindow } =>
  window;

const PdfExportPage: React.FC = () => {
  const { collectionId: param } = useParams<{ collectionId: string }>();
  const collectionId = parseId(param ?? "");

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [expired, setExpired] = useState(false);

  const [options0] = useState(optionsFromQuery);
  const [source, setSource] = useState<ImageSource>(options0.source);
  const [dpi, setDpi] = useState<150 | 200 | 300>(options0.dpi);
  const [typography, setTypography] = useState<PdfTypography>(
    options0.typography,
  );
  const [quality, setQuality] = useState(options0.jpegQuality);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [coarse] = useState(isCoarsePointer);

  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const autoStarted = useRef(false);

  const reload = useCallback(() => {
    setExpired(false);
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!collectionId) {
      return;
    }
    let cancelled = false;
    void LOAD(collectionId).then(
      (next) => {
        if (!cancelled) setState(next);
      },
      (error: unknown) => {
        if (!cancelled) setState(publicFailure(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [collectionId, attempt]);

  // A new collection or reload throws away whatever was on screen.
  useEffect(() => {
    // Throwaway shell: a new collection must reset the run, and this is the
    // one place that knows the id changed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRun({ status: "idle" });
    abortRef.current?.abort();
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    windowWithPrototype().__pdfExport = undefined;
  }, [collectionId, attempt]);

  const ready = state.status === "ready" ? state.value : null;

  const plan = useMemo(
    () => (ready ? buildPdfPlan(ready.artworks) : null),
    [ready],
  );

  const counts = useMemo(() => {
    if (!ready) return null;
    const exportable = ready.artworks
      .filter(isExportableArtwork)
      .sort(compareArtworks);
    const withPhotos = exportable.filter(
      (artwork) => buildPdfPlan([artwork])[0]?.kind === "photo",
    ).length;
    return {
      artworks: exportable.length,
      withPhotos,
      withoutPhotos: exportable.length - withPhotos,
      totalArtworks: ready.artworks.length,
      drafts: ready.artworks.filter(
        (artwork) => (artwork.status ?? "published") === "draft",
      ).length,
      deleted: ready.artworks.filter((artwork) => artwork.deletedAt).length,
    };
  }, [ready]);

  const options = useMemo<ExportOptions>(
    () => ({ source, dpi, typography, jpegQuality: quality }),
    [source, dpi, typography, quality],
  );

  const runExport = useCallback(async () => {
    if (!ready || !plan) {
      return;
    }
    if (abortRef.current) {
      abortRef.current.abort();
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    windowWithPrototype().__pdfExport = undefined;

    const controller = new AbortController();
    abortRef.current = controller;
    setRun({
      status: "running",
      progress: { phase: "preparing", done: 0, total: 0 },
    });

    try {
      const result = await exportCollection(
        ready.collection,
        plan,
        options,
        controller.signal,
        (progress) => {
          if (!controller.signal.aborted) {
            setRun({ status: "running", progress });
          }
        },
      );
      if (controller.signal.aborted) {
        setRun({ status: "cancelled" });
        return;
      }
      const url = URL.createObjectURL(result.blob);
      urlRef.current = url;
      windowWithPrototype().__pdfExport = {
        blob: result.blob,
        url,
        stats: result.stats,
        options,
      };
      setRun({
        status: "done",
        url,
        stats: result.stats,
        options,
        blob: result.blob,
      });
    } catch (error) {
      if (error instanceof ExportAbortedError || controller.signal.aborted) {
        setRun({ status: "cancelled" });
        return;
      }
      if (error instanceof GrantExpiredError) {
        setExpired(true);
        reload();
        return;
      }
      if (error instanceof PhotoUnavailableError) {
        setRun({
          status: "error",
          message: "A photo could not be fetched.",
        });
        return;
      }
      setRun({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [ready, plan, options, reload]);

  // Prototype ergonomics: `?auto=1` starts the export once the collection has
  // loaded, so a headless browser can produce the sample PDF without a click.
  useEffect(() => {
    if (!ready || autoStarted.current) {
      return;
    }
    const auto = new URLSearchParams(window.location.search).get("auto");
    if (auto !== "1") {
      return;
    }
    autoStarted.current = true;
    // Deferred by a tick so the run's first state write is not a cascading
    // render inside this effect.
    const timer = window.setTimeout(() => {
      void runExport();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ready, runExport]);

  const cancel = () => {
    abortRef.current?.abort();
  };

  const downloadName = ready
    ? `${urlizeName(ready.collection.name) || "collection"}.pdf`
    : "collection.pdf";

  if (expired) {
    return (
      <CollectionLockScreen collectionId={collectionId} onUnlocked={reload} />
    );
  }

  if (state.status === "locked") {
    return (
      <CollectionLockScreen
        collectionId={collectionId}
        collectionName={state.collectionName}
        onUnlocked={reload}
      />
    );
  }

  if (state.status !== "ready") {
    return <PublicStateMessage status={state.status} />;
  }

  if (!ready || !plan || !counts) {
    return <PublicStateMessage status="loading" />;
  }

  const { collection } = ready;
  const running = run.status === "running";
  const done = run.status === "done" ? run : null;

  return (
    <Container size="lg" py="2rem">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2}>Collection PDF (prototype)</Title>
            <Text size="sm" c="dimmed">
              {collection.name} — throwaway prototype for #129. Not production
              UI.
            </Text>
          </div>
          <Anchor component={Link} to={`/collection/${param}`} size="sm">
            Back to the collection
          </Anchor>
        </Group>

        <Alert color="orange" title="Prototype">
          The route, the controls and this shell are throwaway. The page plan,
          the measured geometry and the conversion path are the things being
          evaluated.
        </Alert>

        <Paper withBorder p="md">
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <Stat label="Exportable artworks" value={counts.artworks} />
            <Stat label="With photos" value={counts.withPhotos} />
            <Stat label="No photos (grid)" value={counts.withoutPhotos} />
            <Stat label="Planned pages" value={plan.length} />
          </SimpleGrid>
          <Text size="xs" c="dimmed" mt="sm">
            {counts.totalArtworks} live works in the collection: {counts.drafts}{" "}
            drafts and {counts.deleted} deleted are excluded.
          </Text>
        </Paper>

        <Paper withBorder p="md">
          <Group align="flex-end" gap="md" wrap="wrap">
            <Select
              label="Photo source"
              value={source}
              onChange={(value) => value && setSource(value)}
              data={[
                { value: "xlarge", label: "xlarge WebP (oriented)" },
                { value: "original", label: "Original upload" },
              ]}
              allowDeselect={false}
              w={220}
            />
            <Select
              label="Print density"
              value={String(dpi)}
              onChange={(value) =>
                value && setDpi(Number(value) as 150 | 200 | 300)
              }
              data={[
                { value: "150", label: "150 dpi" },
                { value: "200", label: "200 dpi" },
                { value: "300", label: "300 dpi" },
              ]}
              allowDeselect={false}
              w={150}
            />
            <Select
              label="Typography"
              value={typography}
              onChange={(value) => value && setTypography(value)}
              data={[
                { value: "compact", label: "Compact — 9 / 7.5 pt" },
                { value: "template", label: "Template — 12 / 10 pt" },
              ]}
              allowDeselect={false}
              w={230}
            />
            <Select
              label="JPEG quality"
              value={String(quality)}
              onChange={(value) => value && setQuality(Number(value))}
              data={[
                { value: "0.8", label: "0.80" },
                { value: "0.9", label: "0.90" },
                { value: "0.95", label: "0.95" },
              ]}
              allowDeselect={false}
              w={140}
            />
            <Switch
              label="Coarse pointer / mobile viewer"
              checked={coarse}
              readOnly
            />
            <Button onClick={() => void runExport()} disabled={running}>
              {done ? "Generate again" : "Generate PDF"}
            </Button>
          </Group>
        </Paper>

        {run.status === "running" && (
          <Paper withBorder p="md">
            <Group justify="space-between" mb="xs">
              <Text size="sm">
                {run.progress.phase === "preparing"
                  ? `Preparing photos ${run.progress.done} / ${run.progress.total}`
                  : "Building PDF (atomic; cannot be interrupted)…"}
              </Text>
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<IconX size={14} />}
                onClick={cancel}
              >
                Cancel
              </Button>
            </Group>
            <Progress
              value={
                run.progress.total === 0
                  ? 0
                  : (run.progress.done / run.progress.total) * 100
              }
              animated={run.progress.phase === "rendering"}
            />
          </Paper>
        )}

        {run.status === "cancelled" && (
          <Alert color="gray">The export was cancelled.</Alert>
        )}

        {run.status === "error" && (
          <Alert color="red" title="The export failed">
            {run.message}
          </Alert>
        )}

        {done && (
          <Paper withBorder p="md">
            <Group justify="space-between" mb="md" wrap="wrap">
              <Title order={4}>Result</Title>
              <Group>
                <Button
                  component="a"
                  href={done.url}
                  download={downloadName}
                  leftSection={<IconDownload size={16} />}
                >
                  Download
                </Button>
                <Button
                  variant="light"
                  leftSection={<IconExternalLink size={16} />}
                  onClick={() =>
                    window.open(done.url, "_blank", "noopener,noreferrer")
                  }
                >
                  Open PDF
                </Button>
              </Group>
            </Group>

            <Table withRowBorders={false} fz="sm">
              <Table.Tbody>
                <StatRow label="Pages" value={`${done.stats.pages}`} />
                <StatRow
                  label="Photo / grid pages"
                  value={`${done.stats.photoPages} / ${done.stats.gridPages}`}
                />
                <StatRow
                  label="Photos"
                  value={`${done.stats.photosConverted} converted, ${done.stats.photosFailed} unavailable`}
                />
                <StatRow
                  label="Target photo box"
                  value={`${done.stats.targetBox.width} × ${done.stats.targetBox.height} px (${done.options.dpi} dpi)`}
                />
                <StatRow
                  label="Downloaded / converted"
                  value={`${formatBytes(done.stats.sourceBytes)} / ${formatBytes(done.stats.convertedBytes)}`}
                />
                <StatRow
                  label="PDF size"
                  value={formatBytes(done.stats.pdfBytes)}
                />
                <StatRow
                  label="Time"
                  value={`${done.stats.totalMs} ms total (${done.stats.prefetchMs} ms photos, ${done.stats.renderMs} ms render)`}
                />
                <StatRow
                  label="Photo phases"
                  value={`${done.stats.fetchMs} ms fetch, ${done.stats.decodeMs} ms decode, ${done.stats.encodeMs} ms encode (summed over ${done.stats.photos} photos)`}
                />
                <StatRow
                  label="Font fallback"
                  value={
                    done.stats.fallbackCharacters === 0
                      ? "not needed (ASCII only)"
                      : `${done.stats.fallbackCharacters} chars, ${formatBytes(done.stats.fallbackBytes)} fetched in ${done.stats.fallbackMs} ms`
                  }
                />
                <StatRow
                  label="Peak JS heap"
                  value={
                    done.stats.peakHeapMb === null
                      ? "not exposed by this browser"
                      : `${done.stats.peakHeapMb} MB (Chromium only; excludes image memory)`
                  }
                />
                <StatRow
                  label="Options"
                  value={`${done.options.source}, ${done.options.typography} typography, JPEG ${done.options.jpegQuality}`}
                />
              </Table.Tbody>
            </Table>

            {coarse ? (
              <Alert mt="md" color="blue" title="Mobile viewer">
                The native iframe PDF viewer is unreliable on iOS (it can show
                only the first page). Tap <b>Open PDF</b> to open the blob URL
                in Safari&rsquo;s own viewer; Download is always available.
              </Alert>
            ) : (
              <iframe
                title="Collection PDF preview"
                src={done.url}
                style={{
                  width: "100%",
                  height: "80vh",
                  border: "1px solid var(--mantine-color-gray-3)",
                  borderRadius: 4,
                  marginTop: 16,
                }}
              />
            )}
          </Paper>
        )}
      </Stack>
    </Container>
  );
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div>
    <Text size="xs" c="dimmed" tt="uppercase">
      {label}
    </Text>
    <Text size="xl" fw={600}>
      {value}
    </Text>
  </div>
);

const StatRow: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <Table.Tr>
    <Table.Td w={220}>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </Table.Td>
    <Table.Td>
      <Text size="sm">{value}</Text>
    </Table.Td>
  </Table.Tr>
);

export default PdfExportPage;
