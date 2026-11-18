/**
 * The landing page's own palette, derived from the brand marks.
 *
 * The rest of the app takes its colours from Mantine's grey scale; this page
 * is the product's public face and is composed on paper instead. Keeping the
 * four values here — rather than as hex literals in each section — is what
 * lets the header, the bands and the rules stay the same surface when one of
 * them is tuned.
 */
export const LANDING_PALETTE = {
  /** The page's surface, and the header's on `/` only. */
  paper: "#F5F2ED",
  /** Display type and body copy. */
  ink: "#2B2927",
  /** Labels, captions and the record's field names. */
  muted: "#625C55",
  /** The hairline that separates sections and record fields. */
  rule: "rgba(43, 41, 39, 0.18)",
} as const;
