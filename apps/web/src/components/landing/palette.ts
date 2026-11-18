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

/**
 * The one hairline the page draws with: a section divider, the record's field
 * separators and the rule above a column or a list item are all this weight
 * and colour. Kept beside the palette so the value is written once, and a
 * tuning of `rule` still reaches every border the page draws.
 */
export const LANDING_RULE = `1px solid ${LANDING_PALETTE.rule}`;
