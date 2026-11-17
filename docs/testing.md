# Testing

[AGENTS.md](../AGENTS.md) carries the one question a test has to answer and the
mutation rule that makes the answer checkable. This document carries the rest of
the doctrine — the tiers, the catalogue of tests this repository refuses, what
the gate catches and what it does not, and the mechanics a test file has to get
right — because a reviewer needs the catalogue when judging a diff, and an
implementer needs the mechanics once, when writing the test.

It applies to every suite: `packages/shared/tests`, `packages/db/tests`,
`apps/api/tests`, `apps/web/tests` and `infra/cdk/tests`.

## Three tiers

Three tiers, and the first is where nearly everything belongs:

1. **Pure logic over our own data.** Test directly, no DOM and no server:
   `variantSize` / `coverCrop` (`apps/api/src/media/variants.ts`),
   `parseAcquisitionDate` (`packages/shared/src/schemas/artworkImport.ts`),
   `sortPhotos` / `reindexPhotos` (`packages/shared/src/artworkPhotos.ts`),
   `catalogueLimitForTier` (`packages/shared/src/limits.ts`),
   `publicCatalogueState` / `publicFailure`
   (`apps/web/src/components/catalogue/usePublicCatalogue.ts`),
   `catalogueSurface` (`apps/web/src/catalogueSurface.ts`),
   `resolveSkinOptions` (`apps/web/src/skins/registry.ts`), and the access
   verdict (`apps/api/src/access.ts`). Ours end to end, and where a real
   regression lives.
2. **Our value going into the library — only when the failure is invisible in
   review or in a screenshot.** `apps/web/tests/skinHost.test.tsx` reads the
   emitted style tags to prove `cssVariablesSelector` is not `:root`, because a
   skin's type scale leaking onto `/manage` appears in no screenshot anyone
   takes. The Basicx chrome tests read computed `pointer-events`, because jsdom
   does no hit testing and the bug was a link that looked live and went nowhere.
3. **Everything else — don't.** Copy that a `Text` renders, props handed to
   Mantine, a mock's call count with no behavioural meaning, a constant asserted
   against its own value.

## The mutation bar

A test that fails its own mutation earns its place; one that needs three
separate mutations to kill is usually two tests. A new test is therefore written
by breaking the line it exists to protect, watching it go red, and restoring the
line — nothing else tells you the test is doing any work.

## What the bar removes

Each of these could only fail by editing the thing it read:

- A constant against its own value. `MAX_ARTWORK_PHOTOS` is a product choice
  (`packages/shared/src/caps.ts`); asserting it equals `10` cross-checks nothing.
  A **correctness floor** is the other case and it stays: getting it wrong is a
  _silent_ failure rather than a changed preference.
- A set against itself — looping `Object.keys(ACCEPTED_IMAGE_TYPES)` through
  `isAcceptedImageType`, which is `type in ACCEPTED_IMAGE_TYPES`.
- A duplicate, checked at the stronger one first.
- Copy. Rendering a component and asserting a string we wrote appeared.
- A title claiming more than its assertion.

## What has not moved

The bar cuts one way and it is easy to overshoot it in a tidy-up. Unchanged:
the pure-logic half, essentially in full; every tier-2 DOM test; the API
integration suite (it drives the real app against the real local stack —
Postgres, SeaweedFS, Mailpit — so it is the one place the wire, the schema and
the storage path meet); and correct-altitude cases that happen to be near
neighbours of deleted ones.

## What the gate catches

`bun run check` runs the type checker over every package, then ESLint, Prettier
and `knip`; CI runs that command verbatim before the suites that need no
services. `knip` reports a module nothing reaches, a dependency nothing imports,
an import of a dependency the package does not declare, a duplicate export, and
an export nothing references at all.

It does not report a symbol exported only for its own test, because test usage
counts as usage, nor a dead member of an exported interface. Both stay review
calls.

The `knip` ignore list does not grow silently: an entry carries a written
reason, so the next reader can tell a deliberate exception from sediment.

## Test mechanics

- **Component tests need an explicit `afterEach(cleanup)`.** Test files run per
  file with a `// @vitest-environment jsdom` docblock, and the vitest configs
  deliberately do **not** set `globals`, so Testing Library's automatic cleanup
  never registers. Without it, each render stays in the document and the next
  test's queries match the previous test's rows and dialogs. DOM matchers come
  from `import "@testing-library/jest-dom/vitest"`.
- **A `matchMedia` stub must answer an empty query with `true`.** In jsdom, a
  stub that answers `matches: false` for everything makes every
  `mantine-datatable` column vanish, leaving only the selection column. The
  datatable resolves a column's `visibleMediaQuery` through Mantine's
  `useMediaQuery`, which for a column without one calls `window.matchMedia("")`
  in an effect and overwrites its optimistic `true` with the stub's answer;
  Chrome answers an empty query with `true`. Stub `matches: query === ""`.
- **`useModals()` needs a `ModalsProvider`.** It throws without one, so any
  component under test that (transitively) renders a `modals.openConfirmModal`
  call needs `MantineProvider` + `ModalsProvider` + `MemoryRouter` wrapped
  around it.
- **`@mantine/modals` ships no stylesheet in v9.** Modal and Overlay styles come
  from `@mantine/core/styles.css`. `@mantine/notifications` does ship one, and
  `<Notifications />` must be mounted (it is, in `apps/web/src/main.tsx`) for
  `notifications.show` to render.
- **A skin must not use a portaled Mantine component, and its tests need the
  carousel mock.** `Modal`, `Drawer`, `Menu`, `Popover`, `Select`, `Combobox`
  and `Tooltip` all render into `document.body`, outside the skin's scope, and
  would silently pick up the app theme. A skin's test suite also needs a mock
  for `@mantine/carousel` — embla measures real rects, so a real `Carousel`
  initialises against nothing in jsdom.
  `apps/web/tests/helpers/carouselMock.tsx` is that mock, loaded through an
  `async` `vi.mock` factory because `vi.mock` is hoisted above the imports.
- **`bun run test:api` and `bun run test:web` need the local stack.** `test:api`
  sources the root `.env` and runs `stack-up.sh postgres s3 mailpit` before
  vitest. `test:web` needs those services and a running API: the root script
  runs `stack-up.sh`, then `scripts/ensure-api.sh`, which leaves an API already
  listening on `PORT` alone and otherwise starts one and polls `/api/health`.
- **SeaweedFS must advertise an address that still exists.**
  `scripts/stack-up.sh` pins it to loopback, so a DHCP change cannot break a
  stack that script started; a `weed server` started before the pin, or by hand,
  advertises the address the machine had at the time, and its own replication
  then dials a host that may no longer exist. Storage tests answer `500` or time
  out with nothing pointing at the cause. Restart it: `pkill -f "weed server"`,
  then `sh scripts/stack-up.sh s3`.
