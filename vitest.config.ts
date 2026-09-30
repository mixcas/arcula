import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Rules tests are Node-side, not DOM. Component tests use a per-file
    // `// @vitest-environment jsdom` docblock instead of a global environment
    // switch.
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],

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
