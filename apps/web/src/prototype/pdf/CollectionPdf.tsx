/**
 * PROTOTYPE — the Collection PDF's two templates.
 *
 * Throwaway code on `prototype/pdf-export` (#129). Every number below is the
 * template PDF (`docs/templates/pdf/arcula-pdf-template.pdf`, 612×792 pt)
 * measured from its text matrices and image placement, not eyeballed from the
 * PNGs. The measured values are kept in points; the type scale is the one
 * thing the charted design changes (9 pt body / 7.5 pt header) and is a
 * switch so the two can be compared.
 */

import React from "react";
import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import type { Artwork, ArtworkPhoto, Collection } from "@arcula/shared";
import type { PdfPlanPage } from "./plan";

Font.register({
  family: "Darker Grotesque",
  fonts: [
    { src: "/fonts/DarkerGrotesque-Regular.ttf", fontWeight: 400 },
    { src: "/fonts/DarkerGrotesque-Bold.ttf", fontWeight: 700 },
  ],
});

// Titles are catalogue copy, not prose: a hyphen inserted by the renderer is
// an invention, so words are never broken.
Font.registerHyphenationCallback((word) => [word]);

export type PdfTypography = "compact" | "template";

/** React-PDF accepts a family stack and substitutes per code point, which is
 *  the mechanism the fallback font rides on. */
export type PdfFontFamily = string | string[];

interface TypeScale {
  body: number;
  header: number;
  line: number;
  /** Title baseline to the next row's baseline. */
  titleGap: number;
  /** Title baseline to the `--` baseline, as a fixed block divider. */
  separatorBaseline: number;
}

/**
 * `compact` is the charted type (9 pt / 7.5 pt) with the template's line
 * rhythm scaled by 0.75. `template` is the template's own 12 pt / 10 pt, for
 * comparison only.
 */
export const TYPE_SCALES: Record<PdfTypography, TypeScale> = {
  compact: {
    body: 9,
    header: 7.5,
    line: 12.2,
    titleGap: 22.5,
    separatorBaseline: 157.2,
  },
  template: {
    body: 12,
    header: 10,
    line: 16.27,
    titleGap: 30,
    separatorBaseline: 157.2,
  },
};

// ---------------------------------------------------------------------------
// Geometry, in points, measured from the template
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

const MARGIN_LEFT = 72;
const RIGHT_COLUMN_LEFT = 324;
const COLUMN_WIDTH = 216;

/** Header text baseline, from the page's top edge. */
const HEADER_BASELINE = 45.38;

/** The photo box: 390 × 519 pt, centred (111..501 horizontally). */
export const PHOTO_BOX = {
  left: 111,
  top: 73.5,
  width: 390,
  height: 519,
};

/** First metadata baseline on a photo page (Dimensions; Title after skew). */
const PHOTO_METADATA_BASELINE = 641.32;

/** First Title baseline on a grid page, and the block pitch. */
const GRID_FIRST_BASELINE = 83.52;
const GRID_BLOCK_PITCH = 191.52;

/**
 * Where the top of a Text box sits for a wanted baseline.
 *
 * React-PDF lays a line box out from its top; the baseline lands at the type's
 * ascent inside it. The factor is measured from the generated PDF: at 0.8 em
 * the rendered baseline sat ~2 pt low, and 1.06 em lands it on the template's
 * measured baseline. The findings record the before/after.
 */
const topForBaseline = (baseline: number, fontSize: number): number =>
  baseline - fontSize * 1.06;

/** A title's ink is sheared around the block; leave a little room so the
 *  last glyph does not enter the next column. */
const TITLE_SLACK = 6;

/** The fields in the order the design lists them. Empty optional ones are
 *  omitted, which moves everything after them up. */
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

const metadataOf = (artwork: Artwork): Metadata => ({
  title: artwork.title,
  artistName: artwork.artistName,
  serie: artwork.serie,
  media: artwork.media,
  dimensions: artwork.dimensions,
  editions: artwork.editions,
  dateOfCreation: artwork.dateOfCreation,
  placeOfOrigin: artwork.placeOfOrigin,
});

const leftFields = (metadata: Metadata): string[] =>
  [metadata.artistName, metadata.serie, metadata.media].filter(
    (value): value is string => Boolean(value),
  );

const rightFields = (metadata: Metadata): string[] =>
  [
    metadata.dimensions,
    metadata.editions,
    metadata.dateOfCreation,
    metadata.placeOfOrigin,
  ].filter((value): value is string => Boolean(value));

const fullFields = (metadata: Metadata): string[] => [
  ...leftFields(metadata),
  ...rightFields(metadata),
];

/**
 * Every string the document draws, so the fallback-font subset covers exactly
 * what can appear on the page. The placeholder filename is included because a
 * failed image prints it.
 */
export const pdfTexts = (
  collection: Collection,
  pages: PdfPlanPage[],
): string[] => {
  const texts = [collection.name];
  for (const page of pages) {
    if (page.kind === "photo") {
      const metadata = metadataOf(page.artwork);
      texts.push(metadata.title, ...fullFields(metadata), page.photo.name);
    }
    if (page.kind === "grid") {
      for (const artwork of page.artworks) {
        const metadata = metadataOf(artwork);
        texts.push(metadata.title, ...fullFields(metadata));
      }
    }
  }
  return texts;
};

// ---------------------------------------------------------------------------
// Shared text pieces
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    fontFamily: "Darker Grotesque",
    backgroundColor: "#ffffff",
    color: "#000000",
    // React-PDF 4.9.0 shrinks a `wrap={false}` page to its content's height
    // (the Letter size survives in width only). `minHeight` restores it; the
    // findings record the measured MediaBox before and after.
    minHeight: PAGE_HEIGHT,
  },
  header: {
    position: "absolute",
    left: MARGIN_LEFT,
    width: PAGE_WIDTH - MARGIN_LEFT * 2,
    fontWeight: 400,
  },
});

/** The title is the template's Bold with a paint-time shear; the shear is
 *  what produces both the lean and the wrapped-line stagger. The template's
 *  text matrix is `1 0 0.25 -1` (atan 0.25 = 14.04°), not the 10° the design
 *  notes assumed; the findings record the measurement and the stagger. */
const Title: React.FC<{ children: string; size: number; line: number }> = ({
  children,
  size,
  line,
}) => (
  <Text
    style={{
      fontSize: size,
      lineHeight: line / size,
      fontWeight: 700,
      paddingRight: TITLE_SLACK,
      transform: "skewX(-14.04deg)",
    }}
  >
    {children}
  </Text>
);

const Row: React.FC<{ children: string; size: number; line: number }> = ({
  children,
  size,
  line,
}) => (
  <Text style={{ fontSize: size, lineHeight: line / size }}>{children}</Text>
);

// ---------------------------------------------------------------------------
// A metadata block, in flow
// ---------------------------------------------------------------------------
//
// Flow rather than one absolutely positioned Text per row: a real title wraps,
// and only flow makes the rows below it move. That movement is one of the
// things the prototype exists to see.

const FieldStack: React.FC<{
  fields: string[];
  scale: TypeScale;
}> = ({ fields, scale }) => (
  <>
    {fields.map((field) => (
      <Row key={field} size={scale.body} line={scale.line}>
        {field}
      </Row>
    ))}
  </>
);

const PhotoMetadata: React.FC<{ artwork: Artwork; scale: TypeScale }> = ({
  artwork,
  scale,
}) => {
  const metadata = metadataOf(artwork);
  return (
    <>
      <View
        style={{
          position: "absolute",
          left: MARGIN_LEFT,
          top: topForBaseline(PHOTO_METADATA_BASELINE, scale.body),
          width: COLUMN_WIDTH,
        }}
      >
        <Title size={scale.body} line={scale.line}>
          {metadata.title}
        </Title>
        <View style={{ height: scale.titleGap - scale.line }} />
        <FieldStack fields={leftFields(metadata)} scale={scale} />
      </View>
      <View
        style={{
          position: "absolute",
          left: RIGHT_COLUMN_LEFT,
          top: topForBaseline(PHOTO_METADATA_BASELINE, scale.body),
          width: COLUMN_WIDTH,
        }}
      >
        <FieldStack fields={rightFields(metadata)} scale={scale} />
      </View>
    </>
  );
};

const GridBlock: React.FC<{
  artwork: Artwork;
  x: number;
  yBaseline: number;
  scale: TypeScale;
}> = ({ artwork, x, yBaseline, scale }) => {
  const metadata = metadataOf(artwork);
  return (
    <View
      style={{
        position: "absolute",
        left: x,
        top: topForBaseline(yBaseline, scale.body),
        width: COLUMN_WIDTH,
      }}
    >
      <Title size={scale.body} line={scale.line}>
        {metadata.title}
      </Title>
      <View style={{ height: scale.titleGap - scale.line }} />
      <FieldStack fields={fullFields(metadata)} scale={scale} />
      <Text
        style={{
          position: "absolute",
          top: scale.separatorBaseline,
          fontSize: scale.body,
          lineHeight: scale.line / scale.body,
        }}
      >
        --
      </Text>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

const PageHeader: React.FC<{ name: string; scale: TypeScale }> = ({
  name,
  scale,
}) => (
  <Text
    fixed
    style={[
      styles.header,
      {
        top: topForBaseline(HEADER_BASELINE, scale.header),
        fontSize: scale.header,
        lineHeight: 1.2,
      },
    ]}
  >
    {name}
  </Text>
);

const PhotoPage: React.FC<{
  artwork: Artwork;
  photo: ArtworkPhoto;
  image: Blob | null;
  scale: TypeScale;
  collectionName: string;
  fontFamily: PdfFontFamily;
}> = ({ artwork, photo, image, scale, collectionName, fontFamily }) => (
  <Page size="LETTER" wrap={false} style={[styles.page, { fontFamily }]}>
    <PageHeader name={collectionName} scale={scale} />
    <View
      style={{
        position: "absolute",
        left: PHOTO_BOX.left,
        top: PHOTO_BOX.top,
        width: PHOTO_BOX.width,
        height: PHOTO_BOX.height,
      }}
    >
      {image ? (
        <Image
          src={image}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      ) : (
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
          <Text style={{ fontSize: scale.body, color: "#666666" }}>
            Image unavailable
          </Text>
          <Text
            style={{
              fontSize: scale.body,
              color: "#999999",
              marginTop: 4,
            }}
          >
            {photo.name}
          </Text>
        </View>
      )}
    </View>
    <PhotoMetadata artwork={artwork} scale={scale} />
  </Page>
);

const GridPage: React.FC<{
  artworks: Artwork[];
  scale: TypeScale;
  collectionName: string;
  fontFamily: PdfFontFamily;
}> = ({ artworks, scale, collectionName, fontFamily }) => (
  <Page size="LETTER" wrap={false} style={[styles.page, { fontFamily }]}>
    <PageHeader name={collectionName} scale={scale} />
    {artworks.map((artwork, index) => (
      <GridBlock
        key={artwork.id}
        artwork={artwork}
        x={index % 2 === 0 ? MARGIN_LEFT : RIGHT_COLUMN_LEFT}
        yBaseline={
          GRID_FIRST_BASELINE + Math.floor(index / 2) * GRID_BLOCK_PITCH
        }
        scale={scale}
      />
    ))}
  </Page>
);

const EmptyPage: React.FC<{
  collectionName: string;
  scale: TypeScale;
  fontFamily: PdfFontFamily;
}> = ({ collectionName, scale, fontFamily }) => (
  <Page size="LETTER" wrap={false} style={[styles.page, { fontFamily }]}>
    <PageHeader name={collectionName} scale={scale} />
  </Page>
);

/**
 * The whole document. Page order and membership were decided by the plan;
 * this component only decides what each page looks like.
 */
export interface CollectionPdfProps {
  collection: Collection;
  pages: PdfPlanPage[];
  /** photo id → converted JPEG, or null when its fetch failed. */
  images: Map<string, Blob | null>;
  typography: PdfTypography;
  /** A registered family covering glyphs Darker Grotesque lacks. */
  fallbackFamily?: string | null;
}

export const CollectionPdf: React.FC<CollectionPdfProps> = ({
  collection,
  pages,
  images,
  typography,
  fallbackFamily,
}) => {
  const scale = TYPE_SCALES[typography];
  const name = collection.name;
  const fontFamily: PdfFontFamily = fallbackFamily
    ? ["Darker Grotesque", fallbackFamily]
    : "Darker Grotesque";

  return (
    <Document
      title={name}
      author=""
      subject=""
      creator="Arcula"
      producer="Arcula"
    >
      {pages.map((page, index) => {
        if (page.kind === "empty") {
          return (
            <EmptyPage
              key={`empty-${index}`}
              collectionName={name}
              scale={scale}
              fontFamily={fontFamily}
            />
          );
        }
        if (page.kind === "grid") {
          return (
            <GridPage
              key={`grid-${index}`}
              artworks={page.artworks}
              scale={scale}
              collectionName={name}
              fontFamily={fontFamily}
            />
          );
        }
        return (
          <PhotoPage
            key={`photo-${page.photo.id}-${index}`}
            artwork={page.artwork}
            photo={page.photo}
            image={images.get(page.photo.id) ?? null}
            scale={scale}
            collectionName={name}
            fontFamily={fontFamily}
          />
        );
      })}
    </Document>
  );
};

/** PAGE_HEIGHT is exported so the viewer can describe the page size in its
 *  stats without duplicating the number. */
export const PDF_PAGE_SIZE = { width: PAGE_WIDTH, height: PAGE_HEIGHT };
