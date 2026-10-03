import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],

  // One .env at the repo root (API-MIGRATION-QWEN.md §9): the api reads it
  // too, and Vite would otherwise look only at its own root.
  envDir: path.resolve(import.meta.dirname, "..", ".."),

  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },

  server: {
    port: 3000,
    host: true,
  },

  build: {
    outDir: "dist",
  },
});
