import React, { useEffect, useRef, useState } from "react";
import { Box, Pagination, Select, Stack, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { Artwork } from "@arcula/shared";
import ArtworkCard from "@/components/manage/collection/ArtworkCard";
import { artworkCardSpan } from "@/components/manage/collection/artworkCardGeometry";
import { RECORDS_PER_PAGE_OPTIONS } from "@/components/manage/collection/artworksSort";

/**
 * The masonry unit. One grid row is this tall plus the 1 px gap, and a card asks
 * for as many rows as its measured height needs (`artworkCardSpan`). A smaller
 * unit follows the content more closely at the cost of more rows; 8 px keeps a
 * fifty-card page's row count in the low thousands, which every engine lays out
 * without noticing.
 */
const ROW_UNIT_PX = 8;

export interface ArtworksGridProps {
  /** The page slice, already sorted and cut by the list. */
  records: Artwork[];
  /** The ids the selection covers, across pages. */
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  /** The "{slug}-{id}" collection param, reused verbatim in the card links. */
  collectionParam: string;
  /** The committed Collection search; Edit carries it back. */
  searchQuery?: string;
  /** Ask the list to confirm and soft-delete one work. */
  onConfirmDeleteArtwork: (artwork: Artwork) => void;
  /** A list read is in flight. The previous cards stay on screen, dimmed. */
  fetching?: boolean;
  /** What to say when this page has no cards, in whichever state that is. */
  emptyLabel: React.ReactNode;
  page: number;
  onPageChange: (page: number) => void;
  totalRecords: number;
  recordsPerPage: number;
  onRecordsPerPageChange: (recordsPerPage: number) => void;
}

/**
 * One offset per card, measured from the row unit.
 *
 * The measurement is on an effect rather than a callback ref: React 19 treats a
 * callback ref's return value as a cleanup function, and a `ResizeObserver` is
 * not a function, so returning one from a ref would throw on mount.
 */
const useMeasuredSpan = (): [React.RefObject<HTMLLIElement | null>, number] => {
  const ref = useRef<HTMLLIElement | null>(null);
  const [span, setSpan] = useState(1);

  useEffect(() => {
    const element = ref.current;
    // A test that mounts a card outside a layout tree gets no observer, and
    // some old browsers have none at all: the card keeps its one-row span
    // rather than throwing.
    const Observer = globalThis.ResizeObserver;
    if (!element || typeof Observer !== "function") return;
    const measure = () => {
      const next = artworkCardSpan(
        element.offsetHeight || element.scrollHeight,
        ROW_UNIT_PX,
      );
      setSpan((current) => (current === next ? current : next));
    };
    measure();
    // The observer reports again on a resize and when the card's content
    // changes (a wrapped title, an image that landed), which is what settles
    // the first paint's reserved height into the real one.
    const observer = new Observer(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, span];
};

/** One `li` with its measured span, so the card itself stays presentation. */
const ArtworkCardItem: React.FC<{
  artwork: Artwork;
  collectionParam: string;
  searchQuery?: string;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  onConfirmDeleteArtwork: (artwork: Artwork) => void;
}> = (props) => {
  const [ref, span] = useMeasuredSpan();
  return (
    <li ref={ref} style={{ gridRowEnd: `span ${span}`, minWidth: 0 }}>
      <ArtworkCard {...props} />
    </li>
  );
};

/**
 * One page of artworks as masonry cards.
 *
 * A hand-written CSS grid, not Mantine's `Grid`: that one is a wrapping
 * flexbox, so every line is as tall as its tallest item and a portrait card
 * leaves a hole beside a landscape one. Here each card spans its own number of
 * small rows, so the next card flows up under a shorter one while the DOM order
 * — the sorted order — stays exactly as the list handed it over.
 *
 * The columns are read through `useMediaQuery` rather than a stylesheet: there
 * are no CSS modules in this app, and a media query that lives in the same
 * place as the unit and the spans is one thing to read. jsdom answers every
 * query `false` (the test stub), so tests always see the one-column case.
 */
const ArtworksGrid: React.FC<ArtworksGridProps> = ({
  records,
  selectedIds,
  onSelectionChange,
  collectionParam,
  searchQuery,
  onConfirmDeleteArtwork,
  fetching = false,
  emptyLabel,
  page,
  onPageChange,
  totalRecords,
  recordsPerPage,
  onRecordsPerPageChange,
}) => {
  const threeAcross = useMediaQuery("(min-width: 62em)", true, {
    getInitialValueInEffect: false,
  });
  const twoAcross = useMediaQuery("(min-width: 48em)", true, {
    getInitialValueInEffect: false,
  });
  const columns = threeAcross ? 3 : twoAcross ? 2 : 1;
  const pageCount = Math.max(1, Math.ceil(totalRecords / recordsPerPage));

  // The per-page control sits under the cards in the Grid as the footer holds
  // it in the Table, so both views offer the same page size in the same place.
  // It stays on an empty page too: the pager is meaningless with one page, but
  // the page size is still the collector's choice.
  const perPageControl = (
    <>
      <Text size="sm" c="dimmed">
        Artworks per page
      </Text>
      <Select
        aria-label="Artworks per page"
        data={RECORDS_PER_PAGE_OPTIONS.map((option) => ({
          value: String(option),
          label: String(option),
        }))}
        value={String(recordsPerPage)}
        onChange={(value) => {
          if (value !== null) onRecordsPerPageChange(Number(value));
        }}
        w={80}
        size="xs"
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />
    </>
  );

  if (records.length === 0) {
    return (
      <Stack gap="md">
        <div
          style={{
            padding: "var(--mantine-spacing-xl)",
            textAlign: "center",
          }}
        >
          {emptyLabel}
        </div>
        {/* No pager: one page has nothing to move between. */}
        <Box
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--mantine-spacing-xs)",
          }}
        >
          {perPageControl}
        </Box>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Box style={{ position: "relative" }}>
        {/* A dimmed, not emptied, frame while a read is in flight: `aria-busy`
            tells a screen reader the content is being replaced while the
            reader keeps looking at the cards that were there. This is the
            Grid's answer alone — the Table keeps the datatable's own
            `fetching` overlay, and the two are deliberately not restyled to
            match. */}
        <ul
          aria-busy={fetching || undefined}
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridAutoRows: `${ROW_UNIT_PX}px`,
            gap: "1px var(--mantine-spacing-md)",
            opacity: fetching ? 0.5 : 1,
            transition: "opacity 150ms ease",
          }}
        >
          {records.map((artwork) => (
            <ArtworkCardItem
              key={artwork.id}
              artwork={artwork}
              collectionParam={collectionParam}
              searchQuery={searchQuery}
              selected={selectedIds.includes(artwork.id)}
              onSelectedChange={(selected) =>
                // The list's selection is a flat id list shared with the Table,
                // so a tick adds or removes exactly this work and leaves every
                // other pick — including one made on another page — alone.
                onSelectionChange(
                  selected
                    ? [...new Set([...selectedIds, artwork.id])]
                    : selectedIds.filter((id) => id !== artwork.id),
                )
              }
              onConfirmDeleteArtwork={onConfirmDeleteArtwork}
            />
          ))}
        </ul>
      </Box>

      <Box
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "var(--mantine-spacing-sm)",
        }}
      >
        <Box
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--mantine-spacing-xs)",
          }}
        >
          {perPageControl}
        </Box>
        <Pagination
          value={page}
          onChange={onPageChange}
          total={pageCount}
          // Not `sm`: below a threshold Mantine collapses the pager to a
          // label + arrows, and a Grid needs its page numbers as one row of
          // controls under the cards.
          withEdges
        />
      </Box>
    </Stack>
  );
};

export default ArtworksGrid;
