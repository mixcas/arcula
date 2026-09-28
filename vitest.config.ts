import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Rules tests are Node-side, not DOM. Component tests (when added) use a
    // per-file `// @vitest-environment jsdom` docblock instead of a global
    // environment switch.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
