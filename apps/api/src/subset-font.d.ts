// `subset-font` ships no types and the package has no `@types/…` entry. This
// is the whole of the surface we use: a TrueType face in, a TrueType subset
// out. The options are the ones we pass — `targetFormat` — and the rest of
// the library's knobs are deliberately not declared until something needs
// them.
declare module "subset-font" {
  interface SubsetFontOptions {
    /** `"truetype"` keeps the bytes a PDF embedder accepts. */
    targetFormat?: "truetype" | "woff" | "woff2" | "sfnt";
    /** Four-character OpenType tags to drop from the subset. */
    dropTables?: string[];
    /** Four-character layout-feature tags to keep; all of them by default. */
    keepFeatures?: string[];
  }

  /**
   * A subset of `originalFont` covering `text`, as harfbuzz's hb-subset
   * writes it. The result is a complete font: `cmap`, `post`, `name` and the
   * rest survive, which is what a renderer needs.
   */
  export default function subsetFont(
    originalFont: Uint8Array,
    text: string,
    options?: SubsetFontOptions,
  ): Promise<Uint8Array>;
}
