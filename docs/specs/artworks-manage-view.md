# Artworks manage view

**Status: implementation-ready.** This is the contract for the Artworks manage
view. It is precise enough to implement without further design decisions; the
grilling that produced it is recorded in the issue and needs no new ADR.

The product vocabulary is [GLOSSARY.md](../../GLOSSARY.md)'s: **Collection**,
**Artwork**, **Artwork photo**, **Owner**, **Collaborator**, **Draft**,
**Published**, **Deleted**, **Skin** — and the **Artworks manage view** it now
defines. "Layout" is not used for this feature: the glossary lists it under
_Avoid_ for **Skin**, and the app shell already owns the word.

The design record:

- Spec and decisions: [#193](https://github.com/mixcas/arcula/issues/193).
- No ADR. The feature changes no system-wide invariant — the Collection remains
  the only visitor gate ([ADR-0003](../adr/0003-the-collection-gates.md)), the
  API and schema are untouched, and there is no deploy-shape change. The one
  genuine trade-off, measured CSS-grid masonry versus the experimental native
  `grid-lanes`, is cheap to revisit when browsers ship it.

Where it lands:

- `apps/web/src/userSettings.ts` — the stored settings and their total parser.
- `apps/web/src/components/manage/collection/artworksSort.ts` — the shared sort
  model and the sorter both views use.
- `apps/web/src/components/manage/collection/ArtworksList.tsx` — the parent that
  owns view, sort, page, page size and selection, and renders the toolbar.
- `apps/web/src/components/manage/collection/ArtworksViewToggle.tsx` — the
  icon-only segmented control.
- `apps/web/src/components/manage/collection/ArtworksGrid.tsx` and
  `ArtworkCard.tsx` — the grid and one masonry card.
- `apps/web/src/components/manage/collection/ArtworksTable.tsx` — kept, reduced
  to a renderer.
- `apps/web/src/components/manage/CollectionPage.tsx` — passes the list down;
  holds no view logic.

## Problem Statement

On a collection's manage page the artworks are only ever shown as a table. A
table is good at scanning recorded fields, but a collector recognises works by
their photographs, and the table reduces each work to a 48-pixel thumbnail —
checking that a collection looks the way it should means opening the public page
in another tab. The table's sort is also locked to its headers: two columns,
reachable only by clicking small header text, and forgotten on the next visit.
There is no way to say "I work by images" and have the page remember it.

## Solution

The manage page gains an **Artworks manage view**: the existing **Table** and a
new **Grid** of photo cards — masonry, three across on a wide screen. An
icon-only segmented control in the list's toolbar switches between them, and
Table remains the default. The choice and the sort are remembered for every
collection in the browser.

Sorting stops being a property of the Table alone. One shared sort state is read
and written by two controls: the Table keeps its sortable Title and Artist Name
headers, and the Grid gets an external Sort select (Title A-Z, Title Z-A, Artist
Name A-Z, Artist Name Z-A). Both views sort the whole collection, page the same
25/50 slice, and share one selection — so a card ticked in Grid is a row ticked
in Table, and switching views keeps the collector's page, selection and scroll
position.

## User Stories

1. As an Owner or a Collaborator, I want a collection's artworks to open in the
   Table by default, so that the page is unchanged until I ask for something
   else.
2. As an Owner or a Collaborator, I want a control above the list that switches
   between Table and Grid, so that I can choose how I browse without leaving the
   page.
3. As an Owner or a Collaborator, I want the Table segment to show a border-all
   icon and the Grid segment a layout-grid icon, so that the control reads as a
   choice between a table and a grid before I have used it.
4. As a screen-reader user, I want the control to be announced as "Artworks
   manage view" with each segment named, so that two bare icons are not the only
   thing I am offered.
5. As a mouse user, I want a tooltip on each segment, so that I can confirm what
   each icon does before clicking.
6. As an Owner or a Collaborator, I want Grid to lay the works out as photo
   cards, so that I can recognise a collection the way I recognise the works
   themselves.
7. As an Owner or a Collaborator, I want three cards across on a wide screen,
   two on a medium one and one on a narrow one, so that the cards stay readable
   at every window size.
8. As an Owner or a Collaborator, I want the cards to pack into a masonry
   layout, so that a portrait work does not leave a hole beside a landscape one.
9. As an Owner or a Collaborator, I want each card to show the work's primary
   photo at the top, so that the image is the first thing I read.
10. As an Owner or a Collaborator, I want a work with no photo to render
    without an empty image box, so that a missing photo does not look like a
    broken one.
11. As an Owner or a Collaborator, I want the work's title under the photo, so
    that I can identify it without opening it.
12. As an Owner or a Collaborator, I want the artist name under the title, so
    that the card carries the same identity the table row does.
13. As an Owner or a Collaborator, I want a Draft badge on a draft work, so that
    I can tell at a glance which works a visitor cannot see.
14. As an Owner or a Collaborator, I want View, Edit and Delete on every card,
    so that each work can be acted on without leaving the Grid.
15. As an Owner or a Collaborator, I want View to open the work's public page in
    a new tab, so that I can check what a visitor sees without losing my place.
16. As an Owner or a Collaborator, I want Edit to return me to the search I came
    from, so that saving a work does not drop my collection search.
17. As an Owner or a Collaborator, I want Delete to ask for confirmation and
    perform a soft delete, so that I can restore the work from the Deleted view
    afterwards.
18. As an Owner or a Collaborator, I want a checkbox at the top-right of each
    card, so that I can select several works from the Grid the way I select rows
    in the Table.
19. As an Owner or a Collaborator, I want a selected card to look selected, so
    that I can see what a bulk delete would affect.
20. As a screen-reader user, I want each card's checkbox named after its
    artwork, so that "Select" alone is not repeated without meaning.
21. As an Owner or a Collaborator, I want clicking a card's body to do nothing,
    so that ticking its checkbox or selecting text never navigates me away.
22. As an Owner or a Collaborator, I want my view choice remembered when I come
    back and on another collection, so that I do not have to choose Table or
    Grid again every visit.
23. As an Owner or a Collaborator, I want my sort remembered too, so that a
    collection I read by artist stays sorted by artist.
24. As an Owner or a Collaborator, I want the Table's Title and Artist Name
    headers to keep sorting, so that the familiar gesture still works.
25. As an Owner or a Collaborator, I want a Sort select in Grid offering Title
    A-Z, Title Z-A, Artist Name A-Z and Artist Name Z-A, so that I can sort
    without table headers.
26. As an Owner or a Collaborator, I want the two sort controls to agree, so
    that toggling views does not silently reorder the collection.
27. As an Owner or a Collaborator, I want sorted order to apply to the whole
    collection before it is paged, so that page two continues the order rather
    than re-sorting just what is visible.
28. As an Owner or a Collaborator, I want changing the sort to take me to the
    first page, so that I do not land on an empty page after a reorder.
29. As an Owner or a Collaborator, I want both views to page at the same 25 or
    50 works, so that switching views keeps my place.
30. As an Owner or a Collaborator, I want pagination controls under the Grid, so
    that I can reach works beyond the first page.
31. As an Owner or a Collaborator, I want switching views to keep my page, my
    selection and my scroll position, so that the toggle is a change of
    presentation only.
32. As an Owner or a Collaborator, I want a Select all button beside the Sort
    select in Grid, so that I can select a whole page in one click.
33. As an Owner or a Collaborator, I want Select all to change to Clear selection
    once the page is selected, so that the same button undoes it.
34. As an Owner or a Collaborator, I want Select all to cover the page I am
    looking at, not the whole collection, so that one click cannot arm a delete
    of works I have not seen.
35. As an Owner or a Collaborator, I want Delete selected to count every
    selected work across pages, so that I know what I am about to delete.
36. As an Owner or a Collaborator, I want a successful bulk delete to clear the
    selection, so that the next action starts from nothing.
37. As an Owner or a Collaborator, I want my collection search to work in both
    views, so that narrowing the collection is independent of how I look at it.
38. As an Owner or a Collaborator, I want Edit from either view to carry the
    search back, so that a saved work returns me to the results I was reading.
39. As an Owner or a Collaborator, I want the previous cards to stay on screen
    and dim while a search or refresh is in flight, so that I can keep reading
    instead of watching an empty frame.
40. As an Owner or a Collaborator, I want the same error alert with Retry above
    either view, so that a failed read is answered the same way twice.
41. As an Owner or a Collaborator, I want the same no-results panel and Clear
    search action in both views, so that a search that matched nothing reads as
    one answer.
42. As an Owner or a Collaborator, I want the same empty-collection copy in both
    views, so that an empty collection is one state and not two.
43. As an Owner or a Collaborator, I want the artwork count and "N selected"
    text in the same place in both views, so that the toolbar does not jump when
    I toggle.
44. As an Owner or a Collaborator, I want the Deleted view to stay as it is, so
    that restoring works is not changed by how I browse live ones.
45. As an Owner or a Collaborator, I want switching views to make no new
    request, so that a toggle is instant and costs nothing.
46. As an Owner or a Collaborator, I want the page to fall back to the Table when
    the stored settings cannot be read, so that a broken or blocked browser
    storage never leaves me without a list.

## Implementation Decisions

**Vocabulary.** The feature is the **Artworks manage view**, with modes
**Table** and **Grid**; it is added to `GLOSSARY.md` under _What is seen_.
"Layout" is deliberately not used: the glossary reserves it, listing it under
_Avoid_ for **Skin**, and the app shell already owns the word. The feature gets
no ADR: it changes no system-wide invariant, and the one genuine trade-off —
measured CSS-grid masonry versus the experimental native `grid-lanes` — is cheap
to revisit.

**One settings object.** A single browser-storage key holds a single, versioned
JSON object:

```ts
type ArtworksView = "table" | "grid";
type ArtworksSort = "title-asc" | "title-desc" | "artist-asc" | "artist-desc";

interface UserSettings {
  version: 1;
  artworksView: ArtworksView;
  artworksSort: ArtworksSort;
}
```

The parser is total: given `null`, corrupt JSON, a non-object, an unrecognised
`version`, an unknown view or an unknown sort, it returns a complete valid
settings object with the defaults `table` / `title-asc`. A partial object keeps
defaults for whatever is missing. Writes merge into the stored object rather
than replacing it, so a future preference needs no new key. Storage being
unavailable — Safari private mode, a full quota — is caught and degrades to
in-memory defaults; it never fails the page. The preference is per browser, not
per account, and is global across collections.

**One shared sort state.** The settings' sort maps to a runtime
`{ field: "title" | "artistName"; direction: "asc" | "desc" }`. Both controls
write it: the Table's `sortStatus` becomes controlled by the parent and its
`onSortStatusChange` writes the shared state; the Grid's select writes the same
state. Either write also persists. The existing collator
(`sensitivity: "base"`, `numeric: true`) and the id tie-break are unchanged, so
case, accents and numbered titles keep sorting as they do today. A sort change
resets the page to 1; the sort deliberately survives a query change, as it does
today.

**State ownership.** A new parent list component owns the view, the sort, the
page, the page size and the selection, and renders the toolbar plus either the
Table or the Grid. The Table becomes a renderer: it loses its own sort, page,
selection, toolbar and delete orchestration. The toggle is a dumb, controlled
component. The collection page keeps only the collection, the artwork list, the
search and the read lifecycle, and passes them down; it holds no view logic. The
existing query-transition rule is preserved — a committed search is a fresh view
with page 1 and an empty selection, while the sort stays put.

**Toolbar.** One row, wrapping on narrow screens: the left group holds the
count, the "N selected" suffix, the "Updating results…" text and the Delete
selected button; the right group holds the Grid-only Sort select, the Grid-only
Select all button and the always-present view toggle. Sort and Select all
disappear in Table, whose header checkbox already performs that role. The toggle
is icon-only, with a group label and an accessible name per segment plus a
tooltip.

**Selection.** Selection is a list of artwork ids, independent of record
identity (a refetch replaces the objects), and it belongs to the current query
transition. It is shared by both views. The Table keeps its header checkbox,
which selects the current page. The Grid's Select all selects the current page's
ids and becomes Clear selection when all of them are selected; it is hidden when
the page has no cards. A successful delete clears the whole selection;
cancelling leaves it alone.

**Grid geometry.** The Grid is a hand-written CSS grid, not Mantine's `Grid`
component — that one is a wrapping flexbox, so its lines are as tall as their
tallest item and it cannot stagger cards. Columns are 3 from the `md` breakpoint,
2 from `sm`, 1 below. Masonry is achieved with a small `grid-auto-rows` unit and
a per-card `grid-row-end: span N`, where N is derived from the card's measured
height (a `ResizeObserver`), re-measured on resize and content change. This
keeps the sorted DOM order intact, unlike CSS multi-column, and needs no
dependency. Cards are painted from an image aspect ratio known from the
variant's recorded dimensions, so the first paint reserves most of the height
and a measurement only settles it.

**Card anatomy.** Each card is a Mantine `Card` with a `Card.Section` image, the
title (wrapping, with the Draft badge inline), the artist name and a View / Edit
/ Delete row. The image is the `medium` variant, `object-fit: cover`, at the
photo's natural aspect with the height-to-width ratio clamped to between 0.5 (a
2:1 panorama) and 1.4 (a tall portrait); the clamp is the only crop. The image is
lazy-loaded and its alt is empty, because the card names the work immediately
below — the same reasoning as the existing table thumbnail. A work with no photo
renders no image section at all. The checkbox sits at the top-right, over the
image, and over the body when there is no image; the selected card carries a
border/tint. The card body is not a link. The grid is a semantic list with one
list item per card.

**Paging.** Both views share one page size (the existing 25/50 options), one page
state and one sorted set; the page slice is cut after sorting, and the rendered
page is clamped to the row count. The Grid renders Mantine `Pagination` and the
same per-page control beneath the cards.

**States.** The parent keeps the count, the error alert with Retry, the
no-results panel with Clear search and the empty-collection copy, so both views
show one answer. While a read is in flight the cards stay on screen and dim
(`aria-busy`), rather than being covered. Toggling the view triggers no request
and resets nothing.

**Not changed.** No API route, schema, migration or shared-contract change; no
server-side sort or pagination. The Deleted view keeps its own table. No new
dependency.

## Testing Decisions

A good test here asserts an external behaviour that only fails when we change
something of ours: the parser's answer for bad input, the order the collector
sees, what the page writes to storage, what a click selects. It does not assert
Mantine's markup, copy we wrote, breakpoint arithmetic that jsdom cannot lay
out, or pagination the Table's existing tests already cover. The mutation bar
applies: change the line the test claims to cover and it must go red.

Two seams, both existing in kind:

- **The pure settings and sorting module.** The parser is exercised with `null`,
  corrupt JSON, a non-object, an unknown version, an unknown view, an unknown
  sort and a partial object. The extracted sorter is exercised for title and
  artist, both directions, case/accent/number folding, the id tie-break and
  non-mutation. The span arithmetic and the aspect clamp are pure and tested for
  portrait, panorama, square and a zero-size guard. Prior art: the pure-logic
  tests beside `publicCollectionState` and `collectionSettingsSave`.
- **One component seam, the new list parent**, mounted with fake artworks, a
  mocked artwork service and the existing Mantine/Modals/MemoryRouter harness. It
  subsumes the current table test file, whose sort, pagination, selection and
  delete cases are adapted to the parent. It adds: toggling to Grid renders
  cards and writes the stored view; a fresh mount starts in the stored view;
  choosing Artist Name Z-A in Grid and toggling back renders the Table in that
  order with the Artist Name header marked sorted (the proof that both controls
  share one state); ticking a card enables Delete selected and the same work
  shows ticked in Table; Select all selects the page and becomes Clear
  selection. Prior art: the current table tests and the collection-page tests.

Left deliberately untested: the SegmentedControl's own behaviour, card copy, the
column count at each breakpoint, and the `ResizeObserver` wiring — jsdom performs
no layout, so those assertions would test the stub, not the product.

## Out of Scope

- The Deleted view, the public collection skins, and the Collection PDF.
- Server-side sorting, filtering or pagination; any API, schema or contract
  change.
- Per-collection view or sort preferences, and any settings UI outside the
  toggle and the select.
- Cross-tab synchronisation of settings, and settings travelling between
  browsers or accounts.
- Collection-wide Select all, and any bulk action other than delete.
- Drag-to-reorder, column configuration in the Table, and new page-size options.
- Adopting native `grid-lanes` masonry ahead of browser support.

## Further Notes

- The accepted cost of one shared sort: a header click in the Table changes a
  global preference, so the next collection opens with that sort too. This is
  what keeps the two controls from silently disagreeing.
- A user who clears browser storage returns to the Table, sorted Title A-Z. That
  is the intended reset.
- When Chromium and Firefox ship `display: grid-lanes` unflagged, the measured
  spans can be replaced with a few lines of CSS; the card markup and the shared
  state do not change.
- The first paint may settle by a frame while spans are measured; reserving the
  photo box from the variant's dimensions keeps the shift small.
