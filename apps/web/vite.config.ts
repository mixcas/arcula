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

  // Source maps are the local and dev default; production is the one
  // exception, and `scripts/build-lambda.sh` sets this to `off` for a
  // production package and to `on` for dev. It is deliberately NOT
  // VITE_-prefixed: Vite inlines a VITE_ value into the client bundle, and
  // this is a build instruction, not client configuration. `true` is Vite's
  // linked form — a separate .map beside the bundle with a sourceMappingURL
  // comment naming it — never `hidden` (no reference, so no DevTools step)
  // and never `inline` (one unreadable bundle).
  const emitSourceMaps = process.env.ARCULA_SOURCE_MAPS !== "off";

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
      sourcemap: emitSourceMaps,
    },
  };
});
