import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// One .env at the repo root; the api reads it too, and Vite would otherwise
// look only at its own root.
const envDir = path.resolve(import.meta.dirname, "..", "..");

export default defineConfig(({ mode }) => {
  // The dev server's /api proxy target. The web client calls relative
  // /api/... paths; in dev the page origin is :3000 and the api lives on
  // :8000, so Vite forwards /api to the target. In prod the SPA is served by
  // the same task as the api, so /api is same-origin and no proxy is needed —
  // the built bundle carries no env var.
  const env = loadEnv(mode, envDir);
  const apiTarget = env.VITE_API_TARGET ?? "http://localhost:8000";

  return {
    plugins: [react()],

    envDir,

    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
      },
    },

    server: {
      port: 3000,
      host: true,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
      },
    },

    build: {
      outDir: "dist",
    },
  };
});
