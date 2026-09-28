/// <reference types="vite/client" />

// Without these declarations every `import.meta.env.VITE_*` lookup falls through
// to Vite's `[key: string]: any` index signature, which makes
// `@typescript-eslint/no-unsafe-assignment` fire wherever the value is used.
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
}
