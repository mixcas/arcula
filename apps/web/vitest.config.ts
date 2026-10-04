import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // One .env at the repo root (API-MIGRATION-QWEN.md §9): the api reads it
  // too, and Vite would otherwise look only at its own root. Mirrored from
  // vite.config.ts — without it the tests cannot see the VITE_* vars that
  // `src/services/firebase.ts` initializes from, and the three suites that
  // import it die at module load with `auth/invalid-api-key`. Test mode
  // additionally loads the root `.env.test` (the emulator values), which
  // overrides `.env` for tests only.
  envDir: path.resolve(import.meta.dirname, "..", ".."),

  test: {
    // Rules tests are Node-side, not DOM. Component tests use a per-file
    // `// @vitest-environment jsdom` docblock instead of a global environment
    // switch.
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],

    // Installs the stack transport (tests/helpers/stackFetch.ts) before any
    // test file's module graph evaluates — the Better Auth react client
    // captures the global fetch at module load, so the wrapper must be in
    // place first — and clears the session cookie between files, so every
    // file starts anonymous like a fresh tab.
    setupFiles: ["tests/setup.ts"],

    /**
     * Stated rather than left to the default, because the default is the only
     * thing standing between a broken component and a green run.
     *
     * A throw inside a React event handler — a click zone calling a carousel
     * method that does not exist, say — does not fail the test that made the
     * click. The test passes, the file passes, and the error is only ever
     * reported in a separate "Unhandled Errors" block that scrolls past. Vitest
     * 5.0.2 does exit non-zero for it (measured, both for a raw unhandled
     * error and for a throw inside `onClick`), so nothing is broken today and
     * this line changes no behaviour.
     *
     * It is here so that the guarantee is a decision rather than a version
     * accident. The flag is named `dangerously` because it is exactly the kind
     * of edit that looks harmless in a diff and turns a whole class of silent
     * failure back on.
     */
    dangerouslyIgnoreUnhandledErrors: false,

    /**
     * jest-dom's `/vitest` entry calls `expect.extend()` from inside
     * node_modules. Externalized (native-ESM) modules import the
     * package-level `vitest`, not this runner's worker `expect`, so the
     * matchers silently register nowhere. Inlining it into the runner
     * makes that import resolve to the same `expect` the tests use.
     */
    server: {
      deps: {
        inline: ["@testing-library/jest-dom"],
      },
    },
  },
  resolve: {
    alias: {
      // Mirror vite.config.ts so vitest resolves the same `@/` alias the app
      // uses. Without it, the pure-logic modules under src/ (which import
      // `@/types`) fail to resolve when loaded by the unit tests.
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
