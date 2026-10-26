# The Collection PDF prints from its own variant

**Status**: accepted

The exported PDF printed a photo at 390 × 519 pt inside a 468 pt content column,
which on a 612 × 792 pt page with 1 in margins left the page two thirds paper
and one third margin. It was the prototype's photo box — a 3:4 crop of the space
rather than the space itself — and it was the size of the _content column_, not
of the page. The ask was simply that the photo print larger.

The only way it can is to spend pixels, and the largest we keep was not enough.
`xlarge` caps at 2400 px, which is 576 pt at 300 dpi; the tallest box the page
can offer is 580 pt. The largest photo page would have printed 3 pt under its
own box, and no amount of layout would have closed that gap.

## Decision

**The photo box is the whole free rectangle, not a shape.** 504 × 580 pt at
left 54, top 60: the full content column, from just under the header to just
above the metadata band. A photo is `contain` fitted into it and never enlarged,
so the box's own aspect crops nothing — a wider box is free for every work
narrower than it, and it is the only direction a tall work can grow. A 3:4
portrait prints 435 × 580, a 1:1 504 × 504, a 3:2 504 × 336. Had the box been
kept at 3:4 and merely grown, the portrait would gain 32 pt of height and a
landscape nothing; the free rectangle is strictly better for every orientation
and worse for none.

**The margin went to 0.75 in.** The side margin is 54 pt rather than 72, which
buys the box 36 pt on each side. The metadata columns widen from 216 to 234 pt
and keep their 36 pt gutter (54 → 288, 324 → 558). This is the one change that
touches the page rather than the photo, and it is deliberate: the photo's width
is bounded by the paper, so the margin is a photo decision.

**The metadata band moved 23.68 pt down, 641.32 → 665.** It is the photo box's
other edge, and its distance from the box is the whole trade. 665 is the last
step that leaves a three-line Title with every field present 29 pt above the
paper's edge; 690 would put it 4 pt from it. The grid pages' baselines
(83.52 / 191.52 / 157.2) and the header's (45.38) are untouched — the photo page
is where the space was going.

**Density stays 300 dpi.** Lowering it to 200 would have made the _old_ box
comfortably fillable by `xlarge`, and would have been a smaller change — but it
trades print quality for layout, and a collector printing a page is the one
person in the product who will look closely at it. The pixels are affordable;
the sharpness is not re-buyable.

**A new variant, `xxlarge`, at 3000 px.** It is the export's own size, and its
number is derived from the page rather than chosen for a screen: the box needs
2100 × 2417 px at 300 dpi, and 3000 covers it with a quarter of its side in hand
for a box that grows again. It is generated for every photo like the rest, which
keeps the invariant that a photo's variant set is fixed at upload rather than
depending on who will read it. It has a second consumer for free: `SlideImage`
offers it as the widest `srcSet` candidate, and its new per-photo `sizes`
(`min(100vw, aspect × 100vh)`) means only a viewport that really draws a photo
that wide — a 3:2 work on a 4K screen — selects it. No schema change:
`artwork_photo_variants.key` is `text`, and the variant list is code.

**The export walks `xxlarge` → `xlarge` → `original`.** A photo uploaded before
`xxlarge` existed has no 3000 px object and will not get one — there was no
backfill, because the population is a handful of test uploads. `xlarge` prints
the same picture up to 3 pt shorter, and the `original` remains the last resort
it has always been.

**The decode is asked for the box, not for the source.** The source's size is
already on the wire, so the fit is computed before `createImageBitmap` and
handed to it as `resizeWidth`/`resizeHeight`, with `resizeQuality: "high"`.
A 3000 px source never lands in memory whole: four conversions in flight hold
four boxes (4.4 Mpx each) rather than four sources (6.8). A record written
before dimensions were kept decodes at its own size and fits afterwards — the
same picture at a larger peak, which is the correct degradation.

## Considered Options

- **Export at 200 dpi.** Rejected. It is the cheap fix — the old box at 200 dpi
  needs 1083 × 1442 px, which `xlarge` covers twice over — and it buys the
  layout at the cost of the print. The photo would be visibly softer at the same
  physical size, on the one artefact a collector handles.
- **Crop to fill the box (`cover`).** Rejected. `contain` never loses a work's
  edges; a collector exporting a painting wants the painting. A crop would also
  make the printed size depend on the work's aspect in a way the page cannot
  show, so the same collection would print its works at inconsistent scales.
- **A taller-but-not-wider box (grow the old 390 × 519 to 390 × 580).** Rejected.
  It is the same gain for a portrait and none at all for a landscape, and the
  paper was already there. The free rectangle is the whole gain available.
- **Keep 3:4 as the box's aspect and centre the photo in it.** Rejected for the
  same reason: the aspect of the _box_ is meaningless once the fit is `contain`,
  and choosing 3:4 spends width a square or a landscape could have used.
- **A `print` variant with a distinct name, or a size chosen per export.** Rejected.
  A variant is a fixed object written at upload; it cannot be sized per reader
  without abandoning that invariant, and the enum already says what the sizes
  are for (`xlarge` is the slideshow's). `xxlarge` sorts beside `xlarge` and
  reads as the next step in the same ladder.
- **Backfilling `xxlarge` for existing photos.** Rejected. It is a re-encode of
  every photo in the product to serve a handful of test uploads, and the
  `xlarge` fallback already prints the largest page 3 pt short.
- **Generating `xxlarge` only for photos that need it.** Rejected. Nothing knows
  at upload whether a photo will be exported; "does it need it" would be a
  prediction, and a wrong one would surface as a missing object at export.
- **Keeping the flat `sizes="100vw"` on the slideshow.** Rejected once the
  variant existed. A flat `100vw` claims full width for a portrait drawn a third
  of it, and the browser multiplies by DPR — a Retina laptop would fetch the
  3000 px object to draw 800. `sizes` from the photo's own aspect costs one
  string and skips the object everywhere it is not needed.
- **Lowering the JPEG quality to pay for the larger area.** Rejected. Quality
  0.9 is already the trade; the PDF grows by roughly the converted area's growth
  (3.5 → 4.4 Mpx), and the file size is not what the reader of a print cares
  about.

## Consequences

- **No migration.** `artwork_photo_variants.key` is free text and the variant
  table is code, so `xxlarge` ships with the code that writes and reads it — the
  one schema change in this area that does not need the forward-only two-release
  ritual.
- **Every photo carries one more object.** Sixty per ten-photo artwork becomes
  seventy. The cap (`MAX_ARTWORK_PHOTOS`) is unchanged; the cost is storage and
  an encode at upload, and the sweep already treats the variant set as an
  enumeration rather than a literal.
- **The PDF is roughly a quarter larger.** The converted area grew from 3.5 to
  4.4 Mpx per photo page. The spec's **Performance** table is marked stale
  rather than updated with guesses; re-running the benchmark is tracked
  separately.
- **The export's memory peak is flat or lower.** The decode is capped at the box,
  so the larger source costs bandwidth rather than heap — the reason the fit
  moved ahead of the decode in the same change rather than after it.
- **The slideshow's heaviest object is unchanged on ordinary screens.** A phone
  and a Retina laptop still pick `large` and `xlarge`; `xxlarge` is selected only
  where a photo is drawn wide enough to use it.
- **`OBJECT_KEYS` and the suffix algebra are unaffected.** `_xlarge` is not a
  suffix of `_xxlarge` (the character before `xlarge` is `x`), so
  `parseMediaKey` and `splitEntryAndKey` stay unambiguous. The cross-check in
  `tests/pipeline.test.ts` covers a forgotten edit either way.
- **Legacy photos print 3 pt under the box.** Accepted, and the reason the
  ladder exists rather than the export assuming `xxlarge`.
- **Tests.** The box's pixel size (2100 × 2417) is a correctness floor, not a
  preference: the conversion caps there and `xxlarge`'s number is justified by
  it. The ladder, the decode target and the slideshow's `sizes` are tier-1
  assertions over our own data; each fails its own mutation (dropping `xxlarge`
  from the ladder, dropping the decode target, restoring `100vw`, dropping the
  key from `OBJECT_KEYS`, restoring the old box).
