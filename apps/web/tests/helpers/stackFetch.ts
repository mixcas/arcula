// The test transport for the local API stack (plan §11, G8: no MSW — the
// component suites render against the real API). It emulates the one thing
// the browser provides that Node's fetch does not: the Vite dev proxy.
//
// The app is written against its own origin. In the dev browser that origin
// is http://localhost:3000 (Vite), and `/api` on it is forwarded to the API
// on :8000 — same-origin from the page's point of view, which is why the
// session cookie lives on :3000 and no CORS is involved. In the tests the
// page origin is jsdom's default URL, `http://localhost:3000`, exactly the
// dev origin; the Better Auth react client resolves its base to
// `window.location.origin`, and the service layer uses relative `/api/…`
// paths. So every request the app issues "arrives at" :3000 the way it
// would behind the proxy, and this wrapper performs the single proxy step:
// rewrite the host, keep the path, and carry a cookie jar.
//
// Three parts:
//
// 1. **Proxy emulation.** Any request whose origin is the app origin is
//    re-hosted onto the API base (`VITE_API_TARGET`, default
//    `http://localhost:8000`), the same rewrite Vite's `server.proxy`
//    performs. Requests to any other origin pass through untouched.
// 2. **Cookie jar.** One jar — all app traffic shares the app origin, just
//    as it does in the dev browser. `Set-Cookie` headers are captured
//    (including deletion via `Max-Age=0` / expired / empty value, which is
//    how sign-out clears the session) and resent on the next request. The
//    jar is cleared between test files by tests/setup.ts's afterAll, so
//    every file starts anonymous; `resetStackSession()` is also exported
//    for a test that wants to drop the session mid-file.
// 3. **Origin header.** State-changing requests (POST/PUT/PATCH/DELETE)
//    carry `Origin: http://localhost:3000`. Browsers send Origin on
//    same-origin state-changing requests, and the API's Better Auth
//    origin check compares it against `CORS_ORIGINS` — so omitting it is
//    not "neutral", it is a 403 the browser would never produce.
//
// Install via `installStackFetch()` (wired in tests/setup.ts, which runs
// before every test file's module graph — the react client captures the
// global fetch at module load, so the wrapper must be in place first).
// Idempotent across test files that share a worker, via a `Symbol.for`
// mark: the underlying native fetch is recorded on `globalThis` once, so a
// re-evaluated module in the same worker never chains a second wrapper.

const APP_ORIGIN = "http://localhost:3000";
const API_BASE = import.meta.env.VITE_API_TARGET ?? "http://localhost:8000";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const INSTALLED = Symbol.for("arcula.stackFetch.installed");
const UNDERLYING = Symbol.for("arcula.stackFetch.underlying");
const JAR = Symbol.for("arcula.stackFetch.jar");

// The jar lives on globalThis, not in module scope: a worker is reused
// across test files, each with a fresh module registry, but the installed
// wrapper (and its jar) must survive that so the cookie a file's sign-in
// sets is the one the same file's requests carry. `resetStackSession`
// (run in tests/setup.ts's afterAll) keeps files starting anonymous, like
// a fresh browser tab.

function jar(): Map<string, string> {
  const g = globalThis as { [JAR]?: Map<string, string> };
  if (!g[JAR]) g[JAR] = new Map();
  return g[JAR];
}

function underlyingFetch(): typeof fetch {
  const g = globalThis as { [UNDERLYING]?: typeof fetch };
  const real = g[UNDERLYING];
  if (!real)
    throw new Error(
      "stackFetch: installStackFetch() must run before the first call",
    );
  return real;
}

function applySetCookies(headers: Headers): void {
  for (const raw of headers.getSetCookie?.() ?? []) {
    const [pair, ...attrs] = raw.split(";");
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();

    let expired = false;
    for (const attr of attrs) {
      const a = attr.trim().toLowerCase();
      if (a.startsWith("max-age=")) {
        const n = Number(a.slice("max-age=".length));
        if (Number.isFinite(n) && n <= 0) expired = true;
      } else if (a.startsWith("expires=")) {
        const t = Date.parse(a.slice("expires=".length));
        if (!Number.isNaN(t) && t <= Date.now()) expired = true;
      }
    }

    const store = jar();
    if (expired || value === "") store.delete(name);
    else store.set(name, value);
  }
}

function cookieHeader(): string | null {
  const store = jar();
  if (store.size === 0) return null;
  return [...store.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

function proxy(url: URL): URL {
  if (url.origin !== APP_ORIGIN) return url;
  return new URL(url.pathname + url.search, API_BASE);
}

const wrappedFetch: typeof fetch = (input, init) => {
  if (input instanceof Request) {
    // Neither client here produces a Request (the react client passes
    // string URLs, the service layer relative paths); the branch exists so
    // the wrapper satisfies `typeof fetch`. Cookies and Origin ride on the
    // rebuilt headers; an init is not expected alongside a Request.
    const method = input.method.toUpperCase();
    const headers = new Headers(input.headers);
    const cookie = cookieHeader();
    if (cookie) headers.set("cookie", cookie);
    if (STATE_CHANGING.has(method)) headers.set("origin", APP_ORIGIN);
    const target = proxy(new URL(input.url));
    const request = new Request(target, {
      method,
      headers,
      // The DOM lib's BodyInit omits ReadableStream, which undici accepts.
      body: input.body as unknown as BodyInit,
    });
    return underlyingFetch()(request).then((res) => {
      applySetCookies(res.headers);
      return res;
    });
  }

  // Relative URLs resolve against the app origin — exactly what the browser
  // does for the page on :3000.
  const url = proxy(new URL(input, APP_ORIGIN));
  const method = (init?.method ?? "GET").toUpperCase();

  const headers = new Headers(init?.headers);
  const cookie = cookieHeader();
  if (cookie) headers.set("cookie", cookie);
  if (STATE_CHANGING.has(method)) headers.set("origin", APP_ORIGIN);

  return underlyingFetch()(url, {
    ...init,
    method,
    body: init?.body ?? undefined,
    headers,
  }).then((res) => {
    applySetCookies(res.headers);
    return res;
  });
};

export function installStackFetch(): void {
  const g = globalThis as {
    [INSTALLED]?: boolean;
    [UNDERLYING]?: typeof fetch;
  };
  if (g[INSTALLED]) return;
  if (!g[UNDERLYING]) g[UNDERLYING] = globalThis.fetch.bind(globalThis);
  g[INSTALLED] = true;
  globalThis.fetch = wrappedFetch;
}

/** Drop the session (and any other cookie the stack set). */
export function resetStackSession(): void {
  jar().clear();
}
