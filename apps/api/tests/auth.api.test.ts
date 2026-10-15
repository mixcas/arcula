// API integration: the /api/auth mount.
//
// The app is driven in-process with app.request() against the real local
// stack — real Hono routes and middleware, real adapter writes to
// Postgres, real cookies. The elided hop is the outermost TCP one;
// nothing else is stubbed. The stack (postgres, mailpit) is brought up by
// the test script before vitest starts, and .env is sourced there too, so
// the requests carry the same AUTH_BASE_URL the dev server uses.
//
// The auth routes keep Better Auth's native response shape — so assertions
// below read Better Auth's bodies, not the error envelope.

import { app } from "../src/app";
import { client, closeDb } from "../src/db";
import { afterAll, describe, expect, it } from "vitest";

// The request URL's host must match the one in AUTH_BASE_URL for the
// handler's origin handling to see what a browser on :3000 would send.
const API = "http://localhost:8000";
const ORIGIN = "http://localhost:3000"; // CORS_ORIGINS / trustedOrigins

type ReqOpts = {
  body?: unknown;
  cookies?: string;
  bearer?: string;
  /** Send the trusted web Origin (browsers do; curl doesn't). */
  origin?: boolean;
};

// Hono's app.request() resolves to Response | Promise<Response> on Bun;
// awaiting normalizes it.
async function req(
  method: string,
  path: string,
  opts: ReqOpts = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.cookies) headers.Cookie = opts.cookies;
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  if (opts.origin !== false) headers.Origin = ORIGIN;
  return await app.request(`${API}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

// res.json() is typed any by the platform; this is the native Better
// Auth shape the suite asserts against. `get-session` answers
// { session, user } with user at the top level, and `null` when there is
// no session.
type AuthUser = {
  email: string;
  tier?: string;
  [key: string]: unknown;
};
type AuthBody = {
  token?: string;
  user?: AuthUser;
  session?: { userId?: string; [key: string]: unknown };
  code?: string;
  message?: string;
  success?: boolean;
};
async function json(res: Response): Promise<AuthBody | null> {
  return (await res.json()) as AuthBody | null;
}

type Cookie = { name: string; value: string; attrs: string[] };

function setCookies(res: Response): Cookie[] {
  return res.headers.getSetCookie().map((raw) => {
    const [pair, ...attrs] = raw.split("; ");
    const eq = pair.indexOf("=");
    return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attrs };
  });
}

/** The live (not-expired) cookies a response sets, as a Cookie header. */
function cookieHeader(res: Response): string | undefined {
  const live = setCookies(res).filter(
    (c) => !c.attrs.some((a) => /^Max-Age=0/i.test(a)),
  );
  return live.length
    ? live.map((c) => `${c.name}=${c.value}`).join("; ")
    : undefined;
}

const unique = () =>
  `s2-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

afterAll(async () => {
  await closeDb();
});

describe("sign-up", () => {
  it("creates the account, returns the custom fields, and sets the session cookie with the right flags", async () => {
    const email = unique();
    const res = await req("POST", "/api/auth/sign-up/email", {
      body: { email, password: "test-pass-12345", name: "Test User" },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body?.user?.email).toBe(email);
    // The custom column round-trips in the native user shape.
    expect(body?.user?.tier).toBe("free");
    expect(typeof body?.token).toBe("string");

    const cookie = setCookies(res).find(
      (c) => c.name === "better-auth.session_token",
    );
    expect(cookie, "a session cookie was set").toBeDefined();
    expect(cookie!.attrs.join(" ")).toContain("HttpOnly");
    expect(cookie!.attrs.join(" ")).toContain("SameSite=Lax");
    // Locally the cookie must NOT be Secure (plain http), or browsers drop it.
    expect(cookie!.attrs.join(" ")).not.toContain("Secure");
    expect(cookie!.attrs.join(" ")).toContain("Path=/");

    // The DB row agrees: the tier default was applied by the adapter.
    const rows =
      await client`select "tier", "emailVerified" from "user" where "email" = ${email}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].tier).toBe("free");
    expect(rows[0].emailVerified).toBe(false);
  }, 15000);
});

describe("sign-in", () => {
  it("resolves a session for the right password and answers 401 with the native error for the wrong one", async () => {
    const email = unique();
    await req("POST", "/api/auth/sign-up/email", {
      body: { email, password: "test-pass-12345", name: "Test User" },
    });

    const ok = await req("POST", "/api/auth/sign-in/email", {
      body: { email, password: "test-pass-12345" },
    });
    expect(ok.status).toBe(200);
    const body = await json(ok);
    expect(body?.user?.email).toBe(email);
    expect(typeof body?.token).toBe("string");

    const bad = await req("POST", "/api/auth/sign-in/email", {
      body: { email, password: "wrong-password" },
    });
    expect(bad.status).toBe(401);
    // Native Better Auth error shape — /api/auth/* is not re-wrapped in
    // the error envelope (asserted so the envelope cannot creep onto the
    // auth mount).
    const err = await json(bad);
    expect(err?.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(typeof err?.message).toBe("string");
  }, 15000);
});

describe("change-password", () => {
  // The profile page's seam: the page calls this native endpoint, so its
  // failure vocabulary (native codes, not the error envelope) is pinned here.
  it("rejects a wrong current password with the native INVALID_PASSWORD code", async () => {
    const email = unique();
    const up = await req("POST", "/api/auth/sign-up/email", {
      body: { email, password: "test-pass-12345", name: "Test User" },
    });
    const cookies = cookieHeader(up)!;

    const wrong = await req("POST", "/api/auth/change-password", {
      cookies,
      body: {
        currentPassword: "not-the-password",
        newPassword: "new-pass-12345",
      },
    });
    expect(wrong.status).toBe(400);
    expect((await json(wrong))?.code).toBe("INVALID_PASSWORD");
  }, 15000);

  it("changes the password — the old one stops resolving, the new one works", async () => {
    const email = unique();
    const up = await req("POST", "/api/auth/sign-up/email", {
      body: { email, password: "old-pass-12345", name: "Test User" },
    });
    const cookies = cookieHeader(up)!;

    const changed = await req("POST", "/api/auth/change-password", {
      cookies,
      body: {
        currentPassword: "old-pass-12345",
        newPassword: "new-pass-12345",
      },
    });
    expect(changed.status).toBe(200);

    const stale = await req("POST", "/api/auth/sign-in/email", {
      body: { email, password: "old-pass-12345" },
    });
    expect(stale.status).toBe(401);

    const fresh = await req("POST", "/api/auth/sign-in/email", {
      body: { email, password: "new-pass-12345" },
    });
    expect(fresh.status).toBe(200);
  }, 15000);
});

describe("sign-out", () => {
  it("kills the session and clears the cookie", async () => {
    const email = unique();
    const up = await req("POST", "/api/auth/sign-up/email", {
      body: { email, password: "test-pass-12345", name: "Test User" },
    });
    const token = (await json(up))?.token;
    expect(typeof token).toBe("string");
    const cookies = cookieHeader(up)!;

    const out = await req("POST", "/api/auth/sign-out", { cookies });
    expect(out.status).toBe(200);
    const cleared = setCookies(out).filter((c) =>
      c.attrs.some((a) => /^Max-Age=0/i.test(a)),
    );
    expect(
      cleared.map((c) => c.name),
      "the session cookies are cleared",
    ).toContain("better-auth.session_token");

    // The token itself is dead server-side, not just the cookie.
    const after = await req("GET", "/api/auth/get-session", { bearer: token });
    expect(after.status).toBe(200);
    expect(await json(after)).toBeNull();
  }, 15000);

  it("does not opt out of origin/CSRF enforcement in the config", async () => {
    // A cookie state-change from an untrusted Origin answers 403 in dev
    // (verified against the live server) — but Better Auth itself skips
    // origin checks while NODE_ENV is test, so the behaviour cannot be
    // asserted here without testing the library. What IS ours: that the
    // config never disables the checks, which would silence them in
    // production too.
    const { auth } = await import("../src/auth");
    const advanced = (auth.options.advanced ?? {}) as {
      useSecureCookies?: boolean;
      disableCSRFCheck?: boolean;
      disableOriginCheck?: boolean;
    };
    expect(
      advanced.disableCSRFCheck,
      "the CSRF check must not be disabled in config",
    ).toBeFalsy();
    expect(
      advanced.disableOriginCheck,
      "the origin check must not be disabled in config",
    ).toBeFalsy();
  });
});

describe("bearer resolution (the mobile path)", () => {
  it("resolves the session from Authorization: Bearer and answers null for unknown or missing credentials", async () => {
    const email = unique();
    const up = await req("POST", "/api/auth/sign-up/email", {
      body: { email, password: "test-pass-12345", name: "Test User" },
    });
    const token = (await json(up))?.token;
    expect(typeof token).toBe("string");

    const ok = await req("GET", "/api/auth/get-session", { bearer: token });
    expect(ok.status).toBe(200);
    const body = await json(ok);
    // The native get-session shape: { session, user } — user at the top
    // level, with the custom fields.
    expect(body?.user?.email).toBe(email);
    expect(body?.session?.userId).toBeDefined();

    const garbage = await req("GET", "/api/auth/get-session", {
      bearer: "not-a-real-token",
    });
    expect(await json(garbage)).toBeNull();

    const none = await req("GET", "/api/auth/get-session", {});
    expect(await json(none)).toBeNull();
  }, 15000);
});
