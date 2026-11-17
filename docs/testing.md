# Testing

[AGENTS.md](../AGENTS.md) carries the one question a test has to answer and the
mutation rule that makes the answer checkable. This document carries the rest of
the doctrine — the tiers, the catalogue of tests this repository refuses, what
the gate catches and what it does not, and the mechanics a test file has to get
right — because a reviewer needs the catalogue when judging a diff, and an
implementer needs the mechanics once, when writing the test.

It applies to every suite: `packages/shared/tests`, `packages/db/tests`,
`apps/api/tests`, `apps/web/tests`, `infra/cdk/tests` and the repository
tooling's own `scripts/tests`, which runs as `bun run test:scripts`.

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

[AGENTS.md](../AGENTS.md) states the bar: change the line a test claims to
cover, and if it stays green the test was not covering that. A test that fails
its own mutation earns its place; one that needs three separate mutations to
kill is usually two tests. A new test is therefore written by breaking the line
it exists to protect, watching it go red, and restoring the line — nothing else
tells you the test is doing any work.

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

`bun run check` runs the type checker over every package and `scripts`, then
ESLint, Prettier, `check:docs` and `knip`; CI runs that command verbatim before
the suites that need no services. Two of those steps are checks rather than
formatters.

`knip` reports a module nothing reaches, a dependency nothing imports, an import
of a dependency the package does not declare, a duplicate export, and an export
nothing references at all.

`check:docs` reports a pointer into the navigation surface — `AGENTS.md`,
`DESIGN.md`, `GLOSSARY.md` and the docs tree — that resolves to nothing, naming
the file and the line. Its pointers are markdown links and inline-code spans
anchored by a leading `/`, `./` or `../` or by a known top-level directory.

Both leave a gap, and both gaps are deliberate. `knip` does not report a symbol
exported only for its own test, because test usage counts as usage, nor a dead
member of an exported interface. `check:docs` skips absolute URLs, bare
anchors, fenced code blocks, globs and placeholders, and unanchored shorthand —
a bare name or a directory like `routes/` or `src/App.tsx` — so a stale path
written without an anchor is still a review call.

The `knip` config carries no `ignore` entries. It excludes two rules — `types`,
because a component's prop type is API even when knip cannot tell it from a dead
one, and `enumMembers`, which are read through their enum — and it keeps
`scripts/lambda-smoke.mjs` out of the in-repo project because the file is
analysed inside the staged Lambda package it is copied into. A suppression
carries a written reason in the config and is not added silently.

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
  sources the resolved local environment and runs
  `stack-up.sh postgres s3 mailpit` before vitest. `test:web` needs those
  services and a running API: the root script runs `stack-up.sh`, then
  `scripts/ensure-api.sh`, which leaves an API of this checkout already
  listening on `PORT` alone, refuses one from another checkout, and otherwise
  starts this checkout's and polls `/api/health`.
- **The API suite seeds the provider's `oauthResource` row before workers
  fork.** `@better-auth/oauth-provider` inserts that row at auth-context init
  with a find-then-create whose duplicate-key catch reads the error message for
  `unique|duplicate`; Drizzle wraps the violation as `Failed query: …` with the
  constraint error in `cause`, so the race is not caught. Parallel workers on a
  fresh database then reject the auth context instead of sharing the one row,
  which is why `apps/api/tests/globalSetup.ts` inserts it once in the main
  process, before any worker starts.
- **The API on a port names its checkout.** A dev server started from the main
  checkout keeps answering after a worktree begins, so the API carries
  `ARCULA_CHECKOUT` (put there by `ensure-api.sh` and by `apps/api`'s `dev`) and
  `/api/health` answers with it; production's body carries no such key.
  `ensure-api.sh` refuses a stranger with both paths, and the web transport
  (`apps/web/tests/helpers/stackFetch.ts`) asks once per worker before its first
  proxied request, so a bare `vitest run` cannot test another branch either. The
  way out is to stop that API or to give this checkout its own port — `PORT`,
  `AUTH_BASE_URL` and `CORS_ORIGINS` move together, so it is a recipe rather
  than a flag. `sh scripts/stack-down.sh api` stops the server by port when the
  checkout that started it is gone: a removed worktree leaves its API listening
  with no pid file of its own.
- **A worktree borrows the main checkout's stack.** `.env` is gitignored and
  the compose project is named after the main checkout, so
  `scripts/local-env.sh` hands every caller the main checkout's `.env`, and
  `scripts/services.sh` exports `COMPOSE_PROJECT_NAME` so `docker-compose`
  reaches `arcula-postgres-1` rather than inventing a project named after the
  worktree directory. One database, one object store and one mail sink serve
  every checkout, and the shared services keep their data, pid and logs in the
  main checkout's `.stack/`. Two consequences: `stack-down.sh` run from a
  worktree stops that shared stack, and one database holds one schema — a
  branch carrying a migration owns the local DB while it is under test, so a
  sibling worktree must not assume the schema it expected. A fresh worktree
  also has no `node_modules`: `sh scripts/worktree-new.sh <branch>` creates one
  beside the main checkout and runs both installs (the workspace's, then
  `infra/cdk`'s), which is what `bun run check` needs.
- **SeaweedFS must advertise an address that still exists.**
  `scripts/stack-up.sh` pins it to loopback, so a DHCP change cannot break a
  stack that script started; a `weed server` started before the pin, or by hand,
  advertises the address the machine had at the time, and its own replication
  then dials a host that may no longer exist. Storage tests answer `500` or time
  out with nothing pointing at the cause. Restart it: `pkill -f "weed server"`,
  then `sh scripts/stack-up.sh s3`.
