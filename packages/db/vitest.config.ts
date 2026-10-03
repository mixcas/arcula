import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],

    // Same stance as apps/web's config, stated rather than left to the
    // default: an unhandled rejection inside a test should fail the run,
    // not scroll past in a separate block.
    dangerouslyIgnoreUnhandledErrors: false,
  },
});
