import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],

    // Same stance as the workspaces' suites: an unhandled rejection inside a
    // test fails the run instead of scrolling past in a separate block.
    dangerouslyIgnoreUnhandledErrors: false,
  },
});
