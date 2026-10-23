/**
 * The Collection PDF's document.
 *
 * Every number below is the measured template geometry from
 * `docs/specs/pdf-export.md` and `docs/templates/pdf/artwork-page.png`,
 * `artworks-grid.png`, in points. The page plan decided membership and order;
 * this file only decides what each page looks like.
 */

import React from "react";
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import type { Artwork, Collection } from "@arcula/shared";

import type { CollectionPdfPage } from "./collectionPdfPlan";
import {
  ARTWORK_LEFT_FIELDS,
  ARTWORK_RIGHT_FIELDS,
  IMAGE_UNAVAILABLE,
} from "./collectionPdfPreflight";

Font.register({
  family: "Darker Grotesque",
  fonts: [
    { src: "/fonts/DarkerGrotesque-Regular.ttf", fontWeight: 400 },
    { src: "/fonts/DarkerGrotesque-Bold.ttf", fontWeight: 700 },
  ],
});

// Titles are catalogue copy, never prose: a hyphen invented by the renderer is
// a word the artwork does not have.
Font.registerHyphenationCallback((word) => [word]);

export const PDF_PAGE_HEIGHT = 792;

const MARGIN = 72;
const CONTENT_WIDTH = 612 - MARGIN * 2;
const RIGHT_COLUMN_LEFT = 324;
const COLUMN_WIDTH = 216;

const BODY = 12;
const HEADER = 10;
const LINE = 16.27;
const TITLE_RHYTHM = 30;

const HEADER_BASELINE = 45.38;
const PHOTO_BOX = { left: 111, top: 73.5, width: 390, height: 519 };
const PHOTO_METADATA_BASELINE = 641.32;
/** The measured Title → Artist baseline on a photo page. */
const PHOTO_ARTIST_RHYTHM = 28.8;
const GRID_FIRST_BASELINE = 83.52;
const GRID_BLOCK_PITCH = 191.52;
const GRID_SEPARATOR_OFFSET = 157.2;
const TITLE_SLACK = 6;

/**
 * Where a Text box's top sits for a wanted baseline.
 *
 * React-PDF lays a line box out from its top and puts the baseline
 * `fontSize × 1.06` inside it. This converts a measured baseline into a `top`
 * rather than rediscovering the offset per element.
 */
const topForBaseline = (baseline: number, fontSize: number): number =>
  baseline - fontSize * 1.06;

type PdfFontFamily = string | string[];

/** The fields the design prints, in its order. */
interface Metadata {
  title: string;
  artistName: string;
  serie?: string;
  media?: string;
  dimensions?: string;
  editions?: string;
  dateOfCreation?: string;
  placeOfOrigin?: string;
}

const clean = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const metadataOf = (artwork: Artwork): Metadata => ({
  title: artwork.title.trim(),
  artistName: artwork.artistName.trim(),
  serie: clean(artwork.serie),
  media: clean(artwork.media),
  dimensions: clean(artwork.dimensions),
  editions: clean(artwork.editions),
  dateOfCreation: clean(artwork.dateOfCreation),
  placeOfOrigin: clean(artwork.placeOfOrigin),
});

const fieldValues = (
  metadata: Metadata,
  keys: ReadonlyArray<keyof Metadata>,
): string[] =>
  keys.flatMap((key) => {
    const value = metadata[key];
    return value ? [value] : [];
  });

const leftFields = (metadata: Metadata): string[] =>
  fieldValues(metadata, ARTWORK_LEFT_FIELDS);
const rightFields = (metadata: Metadata): string[] =>
  fieldValues(metadata, ARTWORK_RIGHT_FIELDS);
const fullFields = (metadata: Metadata): string[] => [
  ...leftFields(metadata),
  ...rightFields(metadata),
];

const styles = StyleSheet.create({
  page: {
    fontFamily: "Darker Grotesque",
    backgroundColor: "#ffffff",
    color: "#000000",
    // React-PDF 4.9.0 collapses a `wrap={false}` page with no height to its
    // content; the Letter size survives in width only. minHeight restores the
    // 612 × 792 pt MediaBox.
    minHeight: PDF_PAGE_HEIGHT,
  },
  header: {
    position: "absolute",
    left: MARGIN,
    width: CONTENT_WIDTH,
    height: HEADER * 1.2,
    overflow: "hidden",
    fontWeight: 400,
  },
});

/** `maxLines`/`textOverflow` are runtime-supported but absent from 4.9.0's types. */
const headerEllipsis = {
  maxLines: 1,
  textOverflow: "ellipsis",
} as const;

const Title: React.FC<{ children: string }> = ({ children }) => (
  <Text
    style={{
      fontSize: BODY,
      lineHeight: LINE / BODY,
      fontWeight: 700,
      paddingRight: TITLE_SLACK,
      // The template's text matrix is `1 0 0.25 -1`; atan(0.25) = 14.04°.
      // The shear is paint-time: it moves no row.
      transform: "skewX(-14.04deg)",
    }}
  >
    {children}
  </Text>
);

const Row: React.FC<{ children: string }> = ({ children }) => (
  <Text style={{ fontSize: BODY, lineHeight: LINE / BODY }}>{children}</Text>
);

const FieldStack: React.FC<{ fields: string[] }> = ({ fields }) => (
  <>
    {fields.map((field) => (
      <Row key={field}>{field}</Row>
    ))}
  </>
);

const PageHeader: React.FC<{ name: string }> = ({ name }) => (
  <Text
    style={[
      styles.header,
      {
        top: topForBaseline(HEADER_BASELINE, HEADER),
        fontSize: HEADER,
        lineHeight: 1.2,
      },
      headerEllipsis,
    ]}
  >
    {name}
  </Text>
);

const PhotoMetadata: React.FC<{ artwork: Artwork }> = ({ artwork }) => {
  const metadata = metadataOf(artwork);
  return (
    <>
      <View
        style={{
          position: "absolute",
          left: MARGIN,
          top: topForBaseline(PHOTO_METADATA_BASELINE, BODY),
          width: COLUMN_WIDTH,
        }}
      >
        <Title>{metadata.title}</Title>
        {/* Title and Artist are 28.8 pt apart at their layout baselines; a
            wrapped title pushes Artist down by its extra lines. */}
        <View style={{ marginTop: PHOTO_ARTIST_RHYTHM - LINE }}>
          <FieldStack fields={leftFields(metadata)} />
        </View>
      </View>
      <View
        style={{
          position: "absolute",
          left: RIGHT_COLUMN_LEFT,
          top: topForBaseline(PHOTO_METADATA_BASELINE, BODY),
          width: COLUMN_WIDTH,
        }}
      >
        <FieldStack fields={rightFields(metadata)} />
      </View>
    </>
  );
};

const PhotoPage: React.FC<{
  artwork: Artwork;
  collectionName: string;
  fontFamily: PdfFontFamily;
}> = ({ artwork, collectionName, fontFamily }) => (
  <Page size="LETTER" wrap={false} style={[styles.page, { fontFamily }]}>
    <PageHeader name={collectionName} />
    <View
      style={{
        position: "absolute",
        left: PHOTO_BOX.left,
        top: PHOTO_BOX.top,
        width: PHOTO_BOX.width,
        height: PHOTO_BOX.height,
      }}
    >
      {/* The print box is final. The photo pipeline lands in its own ticket;
          until then every photo page draws the specified placeholder. */}
      <View
        style={{
          width: "100%",
          height: "100%",
          borderWidth: 0.75,
          borderColor: "#c9c9c9",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: BODY, color: "#666666" }}>
          {IMAGE_UNAVAILABLE}
        </Text>
      </View>
    </View>
    <PhotoMetadata artwork={artwork} />
  </Page>
);

const GridBlock: React.FC<{
  artwork: Artwork;
  x: number;
  titleBaseline: number;
}> = ({ artwork, x, titleBaseline }) => {
  const metadata = metadataOf(artwork);
  return (
    <View
      style={{
        position: "absolute",
        left: x,
        top: topForBaseline(titleBaseline, BODY),
        width: COLUMN_WIDTH,
      }}
    >
      <Title>{metadata.title}</Title>
      <View style={{ marginTop: TITLE_RHYTHM - LINE }}>
        <FieldStack fields={fullFields(metadata)} />
      </View>
      {/* Identical in every block and independent of which fields are
          present: a grid divider, not a row. */}
      <Text
        style={{
          position: "absolute",
          top: GRID_SEPARATOR_OFFSET,
          fontSize: BODY,
          lineHeight: LINE / BODY,
        }}
      >
        --
      </Text>
    </View>
  );
};

const GridPage: React.FC<{
  artworks: Artwork[];
  collectionName: string;
  fontFamily: PdfFontFamily;
}> = ({ artworks, collectionName, fontFamily }) => (
  <Page size="LETTER" wrap={false} style={[styles.page, { fontFamily }]}>
    <PageHeader name={collectionName} />
    {artworks.map((artwork, index) => (
      <GridBlock
        key={artwork.id}
        artwork={artwork}
        x={index % 2 === 0 ? MARGIN : RIGHT_COLUMN_LEFT}
        titleBaseline={
          GRID_FIRST_BASELINE + Math.floor(index / 2) * GRID_BLOCK_PITCH
        }
      />
    ))}
  </Page>
);

const EmptyPage: React.FC<{
  collectionName: string;
  fontFamily: PdfFontFamily;
}> = ({ collectionName, fontFamily }) => (
  <Page size="LETTER" wrap={false} style={[styles.page, { fontFamily }]}>
    <PageHeader name={collectionName} />
  </Page>
);

export interface CollectionPdfProps {
  collection: Collection;
  pages: CollectionPdfPage[];
  /** Every registered fallback family, in chunk order. */
  fallbackFamilies: string[];
}

export const CollectionPdf: React.FC<CollectionPdfProps> = ({
  collection,
  pages,
  fallbackFamilies,
}) => {
  const name = collection.name;
  const fontFamily: PdfFontFamily = ["Darker Grotesque", ...fallbackFamilies];

  return (
    <Document title={name} creator="Arcula" producer="Arcula">
      {pages.map((page, index) => {
        if (page.kind === "empty") {
          return (
            <EmptyPage
              key={`empty-${index}`}
              collectionName={name}
              fontFamily={fontFamily}
            />
          );
        }
        if (page.kind === "grid") {
          return (
            <GridPage
              key={`grid-${index}`}
              artworks={page.artworks}
              collectionName={name}
              fontFamily={fontFamily}
            />
          );
        }
        return (
          <PhotoPage
            key={`photo-${page.photo.id}-${index}`}
            artwork={page.artwork}
            collectionName={name}
            fontFamily={fontFamily}
          />
        );
      })}
    </Document>
  );
};
