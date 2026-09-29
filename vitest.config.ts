import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Rules tests are Node-side, not DOM. Component tests use a per-file
    // `// @vitest-environment jsdom` docblock instead of a global environment
    // switch.
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
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
