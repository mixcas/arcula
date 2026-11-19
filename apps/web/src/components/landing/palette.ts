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
  /**
   * The conversion doors' fill — the one loud colour on the page.
   *
   * It is deeper than Mantine's `orange.9` (`#d9480f`) because that shade
   * reaches only 4.30:1 against white, and the labels are white: at 5.18:1
   * this one clears WCAG AA for normal text. The whole orange scale was
   * measured, and no shade with white text passes — `orange.7` is 3.04:1 and
   * `orange.8` is 3.58:1. Lighten this past about `#d2480f` and the buttons
   * fail again; the ink-on-`orange.5` pairing (6.49:1) is the other way to
   * stay legible, and it is not the look we want.
   */
  accent: "#c2410c",
} as const;

/**
 * The one hairline the page draws with: a section divider, the record's field
 * separators and the rule above a column or a list item are all this weight
 * and colour. Kept beside the palette so the value is written once, and a
 * tuning of `rule` still reaches every border the page draws.
 */
export const LANDING_RULE = `1px solid ${LANDING_PALETTE.rule}`;
