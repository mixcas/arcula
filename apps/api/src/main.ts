import { serve } from "bun";

// The port comes from the single root .env (plan §9); 8000 is the
// documented default when it is not set.
const port = Number(process.env.PORT) || 8000;

/**
 * The Phase 0 shell: one health endpoint, nothing else.
 *
 * It exists so `bun run dev` runs the final two-process topology from the
 * first phase — and so the port, the boot, and the error shape are all
 * proven while the repo is still small. Every later phase replaces the
 * handler below (plan §3); the `serve` call is what stays.
 */
serve({
  port,
  fetch: (req) => {
    if (req.method === "GET" && new URL(req.url).pathname === "/api/health") {
      return Response.json({ status: "ok" });
    }
    return Response.json({ error: "not implemented" }, { status: 501 });
  },
});
