// The test program (tests/tsconfig.json) includes tests/ only and sets
// `types: ["node"]` — no vite/client, no src/vite-env.d.ts — so it declares
// the minimum ImportMeta surface the tests themselves read. App code is
// typed by apps/web/tsconfig.json (which includes vite/client); the two
// programs never merge, so nothing here can shadow a VITE_* key the app
// declares.
//
// src modules that tests import must not read import.meta.env either:
// the web client is same-origin by design, so no client module needs an env
// var — a future one belongs in this file, not in the app.
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ImportMetaEnv {
  /** The test transport's API target (tests/helpers/stackFetch.ts). */
  readonly VITE_API_TARGET?: string;
}
