# Research: Darker Grotesque assets and the oblique Title

**Status: findings, nothing built.** This answers issue #127 for the Collection
PDF map (#125). No app source, dependency or config is changed here.

## The answer

Ship the **upstream static TTFs** — `DarkerGrotesque-Regular.ttf` (400) and
`DarkerGrotesque-Bold.ttf` (700) — from
`bettergui/DarkerGrotesque@a5c3584/fonts/ttf/`, into
**`apps/web/public/fonts/`**, with the project's `OFL.txt` beside them.
Register them with React-PDF as one family at `fontWeight: 400` and `700`.
Make the Title **`fontWeight: 700` + `transform: "skewX(-10deg)"`** on the
`<Text>`: React-PDF applies transforms at paint time, so the row does not
reflow and the sibling metadata does not move. Add `".ttf": "font/ttf"` to
`apps/api/src/spa.ts`'s `CONTENT_TYPES`.

No italic or oblique face exists anywhere: not on Google Fonts, not in the
upstream release, not in the upstream Glyphs source. A synthesised shear is the
only option short of baking your own derivative — see **The oblique Title**
for the two costs of that choice and the one case where the baked font wins.

## What actually exists

| Source                                                  | What it contains                                                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Google Fonts, `ofl/darkergrotesque`                     | One file, `DarkerGrotesque[wght].ttf` (91,516 B), OFL. `style: normal`, one axis `wght` 300–900. Its default instance is **Light 300**. |
| Upstream `bettergui/DarkerGrotesque@a5c3584` (`master`) | Static TTFs for seven upright weights (`fonts/ttf/`), the same seven as OTF and WOFF, the variable font, and its WOFF2. No slanted.     |
| Upstream `sources/DarkerGrotesque.glyphs`               | Two upright masters (Light, Black), seven upright instances 300–900, no slanted master and no slanted instance.                         |
| Upstream `README.md`                                    | Claims “7 weights and theirs slanted version”. The claim is not backed by any binary or source file in the repository.                  |

Evidence:

- `METADATA.pb` records `style: "normal"`, `weight: 400` and
  `axes { tag: "wght" min_value: 300 max_value: 900 }`; there is no `ital` or
  `slnt` axis.
- `upstream_info.md` records the history: the 2019 static release, then a 2023
  repackaging as a variable font from the same Glyphs source. Both are version
  1.000; the statics are ttfautohinted, the variable font is not.
- The Glyphs source was downloaded and inspected: its `fontMaster` array has two
  upright masters, and `instances` names Light through Black with `weightClass`
  values only. Grepping the whole repository tree for `slant|italic|oblique`
  returns nothing.

So “find the italic” has no answer; the title's lean has to be manufactured.

### The statics are the same design as the screen's variable font

The web app loads the variable font from Google Fonts
(`apps/web/index.html`: `family=Darker+Grotesque:wght@300..900`). The PDF would
ship the statics. Measured against instances generated from the variable font at
400 and 700:

- identical glyph sets (581 glyphs) and identical `cmap` coverage (467
  codepoints, Vietnamese included — checked with a Vietnamese title string);
- every glyph's ink box agrees within **1 font unit (1/1000 em)**, and at a
  400 px render within **1 pixel**;
- advances are identical; 11 side bearings (Regular) / 3 (Bold) differ by 1
  unit, from rounding, not design.

Everything measurable says the statics and the VF come from the same Glyphs
source; choosing one or the other is not a visual decision.

## The files to ship

Pin the upstream commit, not `master`, and verify the hashes:

| File                           | Bytes  | SHA-256                                                            |
| ------------------------------ | ------ | ------------------------------------------------------------------ |
| `DarkerGrotesque-Regular.ttf`  | 78,736 | `5a33d1839921b327d503cace71e6693403df5f5f39d47f10c25bf7265c8bef52` |
| `DarkerGrotesque-Bold.ttf`     | 79,460 | `27c8e3e7dda7a96729c851e32b4d133c018f3c982191d700c6d810c51c916914` |
| `OFL.txt` (from the same repo) | 4,402  | —                                                                  |

URLs, pinned to `a5c3584b44ab3a7d272565662139ee07bb72e8e8`:

```
https://raw.githubusercontent.com/bettergui/DarkerGrotesque/a5c3584b44ab3a7d272565662139ee07bb72e8e8/fonts/ttf/DarkerGrotesque-Regular.ttf
https://raw.githubusercontent.com/bettergui/DarkerGrotesque/a5c3584b44ab3a7d272565662139ee07bb72e8e8/fonts/ttf/DarkerGrotesque-Bold.ttf
https://raw.githubusercontent.com/bettergui/DarkerGrotesque/a5c3584b44ab3a7d272565662139ee07bb72e8e8/OFL.txt
```

Both files are `fsType 0` (installable embedding), so PDF embedding is expressly
allowed; both carry the OFL notice in name IDs 0, 13 and 14.

### Why not the variable font

React-PDF's own font documentation says variable fonts “do not work properly
because PDF 2.0 spec does not support those” and asks for separate registered
files. Measured with `@react-pdf/renderer@4.9.0` (the current release), the
failure mode is worse than an error:

- registering `DarkerGrotesque[wght].ttf` **renders** — but every text run draws
  the font's default master, **Light 300**, whatever `fontWeight` is requested.
  `fontWeight: 700` and `900` both produced the Light face, byte-for-byte the
  same embedded subset. Nothing logs a warning.
- the same test with the static files selects 400 and 700 correctly.

So “React-PDF rejects variable fonts” is not literal in 4.9.0: it silently
ignores the axis. Either way, it is the wrong file.

### If byte-identical-to-the-screen ever matters

Instance the VF instead of shipping upstream's statics:

```sh
fonttools varLib.instancer "DarkerGrotesque[wght].ttf" wght=400 --update-name-table -o DarkerGrotesque-Regular.ttf
fonttools varLib.instancer "DarkerGrotesque[wght].ttf" wght=700 --update-name-table -o DarkerGrotesque-Bold.ttf
```

Each instance is 58.8 KB (unhinted, no `gvar`/`HVAR`/`STAT`), versus 78.7 KB for
the autohinted upstream statics. **Without `--update-name-table` the instances
keep the VF's `Darker Grotesque Light` names**, which is how you end up with a
PDF whose Regular and Bold subsets are both called `DarkerGrotesque-Light`; the
flag is not optional. This route buys 20 KB per file and exact revision parity
at the cost of a fonttools step in asset prep. The upstream statics are the
simpler, better-provenanced choice; the 1-unit difference does not justify the
toolchain.

### Cost on the wire

158 KB for both files, 83 KB gzipped. React-PDF subsets before embedding: a
14 KB test PDF with both faces carried a 6,778 B Bold subset and a 9,598 B
Regular subset. The two files are fetched once per page and then held by the
browser cache (one hour; see **The MIME type**).

## The oblique Title

### `skewX` — recommended

```tsx
<Text
  style={{
    fontFamily: "Darker Grotesque",
    fontWeight: 700,
    transform: "skewX(-10deg)",
  }}
>
  {artwork.title}
</Text>
```

What was measured (`@react-pdf/renderer@4.9.0`, Letter page, 14 pt title in a
200 pt box, a sibling in the same flex row, a paragraph below):

- the emitted text matrix gains `c = 2.469` on the title's run
  (`14 × tan 10°`); its origin shifts −0.94 pt; its baseline `y` is unchanged;
- the sibling in the row and the paragraph below keep **exactly** the same x/y
  as without the transform;
- text extraction reports the skewed matrix, so copying from the PDF still
  matches what is on the page.

Why it is layout-neutral: transforms are applied in
`packages/render/src/operations/transform.ts` while painting
(`packages/render/src/primitives/renderNode.ts` applies them before the node's
own renderer), after Yoga has already sized and positioned the node. Nothing in
`@react-pdf/layout` reads `transform` except the SVG branch and the node's
`origin`. The default `transformOrigin` is `50% 50%` of the node's box
(`packages/layout/src/node/getOrigin.ts`).

Advantages over a baked face: shaping is untouched. Kerning, `GPOS` mark
attachment and Vietnamese combining marks are shaped upright and then the whole
run is sheared, so they cannot be misplaced. Zero extra bytes, zero build step,
zero derived font to maintain.

Two costs, both measured, both worth deciding on before the layout is drawn:

1. **Visual overflow.** The layout box stays upright while the glyphs lean, so
   the title's ink extends past its box by `tan(10°) × half the line box` —
   about 1 pt at 9 pt type and 1.5 pt at 14 pt. Leave a few points of slack
   between the Title column and the right-hand metadata column (or add
   `paddingRight` to the Title) rather than letting the last glyph touch the
   column.
2. **Wrapped titles fan.** A block shear rotates around the block's centre, so
   line 2 starts slightly left of line 1. Measured on a two-line 14 pt title
   (line-height 18.98 pt): line 1 starts at x 40.73, line 2 at x 37.38 — a
   **3.35 pt stagger**. A real oblique font would keep both lines at x 40. There
   is no per-line transform in React-PDF, so this cannot be fixed with
   `transformOrigin`. At 9 pt type with a 1.2 line-height the stagger is about
   1.9 pt.

**Decision:** use the skew, and check the prototype's real titles as the test.
If the PDF's Title column routinely wraps and the stagger reads as sloppy,
switch to a baked oblique — but treat that as a design call, not a technical
necessity. Wrapped-line alignment is the only visual difference between the two
approaches.

### The baked oblique — only if the wrapped-line stagger is rejected

A static oblique can be made with fontTools by shearing every glyph about the
baseline (`x' = x + tan(θ)·y`), setting `post.italicAngle`, the `OS/2` italic
bit, `head.macStyle`, and rewriting the name table. It does fix the wrap: both
lines started at x 40 in the measured render, and the file was 68,076 B.

It also introduces defects the shear-on-`Text` approach does not have:

- **`GPOS` anchors are not sheared.** Combining-mark attachment is stored in
  `GPOS` in design units; outlines move, anchors do not. Precomposed Vietnamese
  is fine; a decomposed mark would sit at the upright x offset.
- **Composites are decomposed** by the pen-based rewrite (accented glyphs become
  outlines). Correct to look at, but a structural change to the font.
- **Hinting is dropped** (the instructions no longer match the sheared outlines,
  so they must go).
- **Registration has a trap.** A face registered as `fontStyle: "oblique"` does
  **not** work in 4.9.0 even with a registered oblique source: the layout's font
  fallback list always appends `Helvetica`, and the Helvetica family has no
  oblique entry, so resolution throws
  `Could not resolve font for Helvetica, fontWeight 700, fontStyle oblique`.
  Register the face as `fontStyle: "italic"` (the standard Helvetica italic
  fallback exists) or as a **separate family** with `fontStyle: "normal"`, both
  of which were verified to render.

Because it is a derivative, it must ship under the same OFL (see **Licence**);
there is no Reserved Font Name in this project, so the family name may stay.

Verdict: not worth it for v1. The skew is one style line and cannot mis-shape
text; the bake is a script, a derived binary and a registration caveat to buy
better multi-line alignment.

### What not to do

- `fontStyle: "oblique"` (or `"italic"`) with only the upright files registered:
  React-PDF does not synthesise, it throws
  (`Could not resolve font for …, fontStyle italic`).
- Registering the variable font for the bold title. It renders Light (above).

## Where the files live, and production serving

**Recommended: `apps/web/public/fonts/`.**

```
apps/web/public/fonts/DarkerGrotesque-Regular.ttf
apps/web/public/fonts/DarkerGrotesque-Bold.ttf
apps/web/public/fonts/OFL.txt
```

- Vite copies `public/` verbatim into `dist/`, and `scripts/build-lambda.sh`
  copies `apps/web/dist` into the Lambda package, so the files ship with no
  extra step.
- The URL is stable and absolute — `/fonts/DarkerGrotesque-Regular.ttf` — in
  both `vite dev` and the Lambda, with no import shim and no hashed name to
  look up. The licence sits next to the binaries it covers.
- The alternative, an `?url` import from `src/`, emits
  `/assets/DarkerGrotesque-Regular-<hash>.ttf` and inherits the immutable
  cache header. It is a real benefit only if you also want the licence to move
  to `public/` anyway; for 158 KB the simple path wins. If you take the hashed
  route, the `.ttf` MIME below is still needed.

### The MIME type

`apps/api/src/spa.ts`'s `CONTENT_TYPES` has `.woff2` but **no `.ttf`**, so today
a TTF would be served as `application/octet-stream`. Add:

```ts
".ttf": "font/ttf",
```

(`font/ttf` is the RFC 8081 registration; `.otf`/`font/otf` is the matching
addition if the family ever ships OTF.)

This is hygiene, not the thing that makes the export work: `@react-pdf/font`
fetches the URL with `fetch()` and reads `arrayBuffer()`
(`packages/font/src/font-source.ts`), so it never inspects the response type. It
matters for a `<link rel="preload" as="font" type="font/ttf">` if one is ever
added, for devtools and proxies, and for not teaching the app that fonts are
opaque bytes.

One production sharp edge worth knowing: a **missing font path does not 404**.
`spa.ts` falls through to `index.html`, so `/fonts/typo.ttf` answers `200
text/html`, and fontkit then fails with a parse error that points nowhere near
the typo. Verify the two paths, and let the export surface the rejection.

Caching is already settled by the existing rule: `/fonts/…` is not under
`/assets/`, so it gets `public, max-age=3600`. That is fine for two files that
change only with a font release; bump the filename if a different file ever
takes the same path. If you want immutable caching you would either move to the
hashed `src` import or special-case `/fonts/` in `cacheControl` — do not add the
immutable header to an unhashed path.

A cheap regression test in the existing `apps/api/tests/spa.api.test.ts` style:
write a `fonts/x.ttf` fixture into the throwaway dist tree and assert
`font/ttf` plus the one-hour header. It is the same shape as the existing
`.js`/`manifest.json` cases.

## Register and styles

```ts
import { Font } from "@react-pdf/renderer";

Font.register({
  family: "Darker Grotesque",
  fonts: [
    { src: "/fonts/DarkerGrotesque-Regular.ttf", fontWeight: 400 },
    { src: "/fonts/DarkerGrotesque-Bold.ttf", fontWeight: 700 },
  ],
});
```

`Font.register` is global and lazy: sources load on the first render that needs
them, so the calls belong at module scope once, not inside the page component.
The family name is local to React-PDF's font store; it does not collide with the
CSS family of the same name. `fontStyle` can be omitted (it defaults to
`normal`), which is intentional — see the oblique trap above.

Styles:

```ts
const styles = StyleSheet.create({
  body: { fontFamily: "Darker Grotesque", fontWeight: 400, fontSize: 9 },
  title: {
    fontFamily: "Darker Grotesque",
    fontWeight: 700,
    fontSize: 9,
    transform: "skewX(-10deg)",
    // default is the box centre; stated so the choice is visible
    transformOrigin: "50% 50%",
  },
});
```

`transform` is a string on the text style; `skewX` is parsed in
`@react-pdf/stylesheet` and turned into the `skew` operation above. `-10deg`
leans right; the angle is a design choice, not a font fact — 10° was the value
measured here.

## Licence

Darker Grotesque is SIL Open Font License 1.1, copyright 2019 The Darker
Grotesque Project Authors. The `OFL.txt` in the upstream repository is
byte-identical to Google Fonts'.

What that obliges, for this use:

- Bundling the TTFs with the app is permitted; the fonts may not be sold on
  their own.
- Every copy must carry the copyright notice and the licence. Ship
  `apps/web/public/fonts/OFL.txt`; the binaries also embed the notice in their
  name tables, but the file is the human-readable copy the licence asks for.
- No Reserved Font Name is declared anywhere in this `OFL.txt`, so even a
  modified (baked-oblique) version could keep the family name — but it must
  still be distributed under the OFL, not the repo's MIT licence.
- PDFs made with the font are documents, not redistributions of the font; the
  OFL explicitly does not restrict them.

The repository's root `LICENSE` is MIT and covers the code; the font folder's
`OFL.txt` is the separate notice for the two binaries. The README's
acknowledgments already name the typeface.

## Still uncertain

- **Do the real titles wrap?** The 3.35 pt stagger only appears on a second
  line. The prototype's actual column width and title lengths decide whether the
  skew is invisible or visibly off — this is the one finding that could flip the
  recommendation to the baked oblique.
- **The angle.** 10° is a starting point chosen for measurement, not from the
  design. A true oblique is usually 10–14°; the effect on the wrap stagger and
  the overflow scales with the tangent.
- **The title size** used here (9/14 pt) comes from the map's body 9 pt; the
  prototype's geometry (still open in #125) sets it.
- **Cache policy.** One hour is the current `spa.ts` default and is probably
  enough; if the export page is expected to be opened repeatedly, preloading
  the two files is an option but not required.
- **Version coupling.** #126 pins `@react-pdf/renderer`. All measurements are
  4.9.0; the font docs and the `transform`/font-resolution code paths are stable
  across v4, but re-run the skew check against the pinned version.

## Sources

- Google Fonts metadata and files:
  <https://github.com/google/fonts/tree/main/ofl/darkergrotesque> —
  `METADATA.pb`, `upstream_info.md`, `OFL.txt`, `DarkerGrotesque[wght].ttf`.
- Upstream project:
  <https://github.com/bettergui/DarkerGrotesque> at
  `a5c3584b44ab3a7d272565662139ee07bb72e8e8` — `fonts/ttf/`, `sources/`,
  `OFL.txt`, `README.md`.
- React-PDF fonts (TTF/WOFF only, variable fonts unsupported):
  <https://react-pdf.org/fonts>
- React-PDF styling, `transform` list and `transformOrigin`:
  <https://react-pdf.org/styling>
- React-PDF source, read at HEAD on 2026-10-22:
  `packages/render/src/operations/transform.ts`,
  `packages/render/src/primitives/renderNode.ts`,
  `packages/render/src/primitives/renderText.ts`,
  `packages/font/src/font-source.ts`,
  `packages/layout/src/node/getOrigin.ts`,
  `packages/layout/src/text/getFragments` (the Helvetica fallback),
  `packages/stylesheet/src/resolve/transform.ts`.
- RFC 8081 (`font/ttf`): <https://www.rfc-editor.org/rfc/rfc8081>
- SIL OFL 1.1: <https://openfontlicense.org/>

## Appendix: how the claims were checked

All scratch work outside the repo, with `@react-pdf/renderer@4.9.0`,
`pdfjs-dist@6.4.299`, PyMuPDF 1.28.2 and fontTools 4.67.0.

- **Static vs VF shapes.** Instanced the VF at 400/700; compared glyph sets,
  `cmap`, per-glyph ink bounds, advances, and a 400 px per-glyph render through
  Pillow. Max bounds delta 1 unit; max render delta 1 px.
- **Variable font behaviour.** Rendered the same string with the VF at 400, 700
  and 900; extracted the text and the embedded font; all three selected the
  Light master. Static 400/700 selected the right faces.
- **Skew.** Rendered a document twice, with and without
  `transform: "skewX(-10deg)"`; read the text matrices and positions with
  pdf.js (`getTextContent`), and rendered both pages to PNG with PyMuPDF to
  inspect the result. The 14 pt run carried `c = 2.469`; the sibling and the
  following paragraph were byte-identical in position.
- **Wrapped skew.** A two-line 14 pt title in a 180 pt box: line starts 40.73
  and 37.38, versus 40.00/40.00 unskewed; the sibling below stayed at 40.00.
- **Baked oblique.** Sheared `DarkerGrotesque-Bold.ttf` 10° with fontTools
  (`TransformPen` → `TTGlyphPen`, `italicAngle`, `fsSelection`, `macStyle`,
  name table); rendered it, measured the aligned line starts, and probed the
  `fontStyle: "oblique"` resolution failure. It works; it is just not worth the
  extra assumptions for this document.
- **Font metadata.** `fsType 0`, `unitsPerEm 1000`, `italicAngle 0`, 581
  glyphs, 467 codepoints, identical `cmap` coverage between the statics and the
  VF.
