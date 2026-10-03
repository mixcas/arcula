import { serve } from "bun";
import { app } from "./app";

// The port comes from the single root .env (plan §9); 8000 is the
// documented default when it is not set.
//
// `Bun.serve({ port, fetch: app.fetch })` — Hono's `fetch` interface is
// Bun's natively (§9.4). The routes live in app.ts so the test suite
// can drive them without this file; the serve call is what stays.
const port = Number(process.env.PORT) || 8000;

serve({ port, fetch: app.fetch });
