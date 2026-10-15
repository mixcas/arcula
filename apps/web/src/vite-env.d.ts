/// <reference types="vite/client" />

// Without these declarations every `import.meta.env.VITE_*` lookup falls through
// to Vite's `[key: string]: any` index signature, which makes
// `@typescript-eslint/no-unsafe-assignment` fire wherever the value is used.
interface ImportMetaEnv {
  // The test transport's API target (tests/helpers/stackFetch.ts); unset
  // falls back to http://localhost:8000. Never read by app code — the app
  // is same-origin and calls relative /api paths.
  readonly VITE_API_TARGET?: string;
}
