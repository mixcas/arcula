import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],

    // Same stance as the other suites: an unhandled rejection inside a test
    // should fail the run, not scroll past in a separate block.
    dangerouslyIgnoreUnhandledErrors: false,
  },
});
