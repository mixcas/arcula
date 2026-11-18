# apps/web — agent notes

There is no package README: [the architecture map](../../docs/architecture.md)
is this package's module map. Read it first, then the repository
[README](../../README.md) for commands and [the testing
doctrine](../../docs/testing.md) for test mechanics. This file carries only the
deltas.

- **Versions are in `package.json`.** React 19, Vite 8 and Mantine 9 are pinned
  there, as is every Mantine package; those are the numbers as of this writing,
  and the file wins if they disagree.
- **Mantine questions start at the installed skill and its reference.**
  [the mantine-ui SKILL.md](../../.agents/skills/mantine-ui/SKILL.md) and the
  exact-API [mantine-llms.txt](../../.opencode/docs/mantine-llms.txt) are the
  source for props, theming and hooks.
- **Import `lodash` by subpath.** `import debounce from "lodash/debounce"` (as
  in `src/components/manage/CataloguePage.tsx`); a root import drags the whole
  library into the bundle.
- **Portals escape a skin's scope.** `Modal`, `Drawer`, `Menu`, `Popover`,
  `Select`, `Combobox` and `Tooltip` render into `document.body`, outside the
  `cssVariablesSelector` a skin sets (`src/skins/types.ts`), so a skin must not
  use one.
- **`VITE_*` is build-time.** `vite.config.ts` points `envDir` at the repo-root
  `.env`, and Vite inlines every `VITE_` value into the bundle: a change needs a
  rebuild, and a value under that prefix ships to the browser.
- **Component tests need their own cleanup.** `globals` is off, so a jsdom test
  needs the `// @vitest-environment jsdom` docblock and an explicit `cleanup()`
  — in `afterEach`, or at the end of the test; without it the next test matches
  the previous render's DOM.
- **A production build is map-free by design.** [scripts/build-lambda.sh](../../scripts/build-lambda.sh)
  sets `ARCULA_SOURCE_MAPS=off` for production and its pre-zip gate refuses a
  stray map, while `vite.config.ts` explains why the variable is deliberately
  not `VITE_`-prefixed. Never "fix" a missing `.map`: the cost and the dev
  exception are in [the infrastructure README](../../infra/cdk/README.md)'s
  "Source maps and the dev artifact".
