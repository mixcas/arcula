// The app-level test helpers: how a suite builds a request, reads a body, and
// signs a user in.
//
// Seven suites had their own `req`, five their own `freshUser`, two an `err` —
// and the copies had drifted: one took an already-serialised body and another
// any value, one sent `Origin` unconditionally and another behind a flag, one
// returned the token and the rest the session user's id. What follows is the
// union of what they were doing, which is what makes it one helper.

import { expect } from "vitest";
import { app } from "../../src/app";

export const API = "http://localhost:8000";
export const ORIGIN = "http://localhost:3000"; // CORS_ORIGINS / trustedOrigins

export const uuid = () => crypto.randomUUID();

export interface ReqOpts {
  cookies?: string;
  bearer?: string;
  /** A serialised JSON body, or any value to be serialised. */
  body?: unknown;
  /** Extra headers; an explicit Content-Type wins over the default. */
  headers?: Record<string, string>;
  /** Send the trusted web Origin (browsers do; curl doesn't). */
  origin?: boolean;
}

// Hono's app.request() resolves to Response | Promise<Response> on Bun;
// awaiting normalizes it.
export async function req(
  method: string,
  path: string,
  opts: ReqOpts = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.cookies) headers.Cookie = opts.cookies;
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  if (opts.origin !== false) headers.Origin = ORIGIN;
  if (opts.body !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return await app.request(`${API}${path}`, {
    method,
    headers,
    body:
      opts.body === undefined || typeof opts.body === "string"
        ? opts.body
        : JSON.stringify(opts.body),
  });
}

export async function json<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** The error envelope: the code, the failed fields and the structured
 *  details. `details` is `error.details` when the route nested it (the
 *  wrong-account invited email) and the flat extra keys otherwise. */
export async function err(res: Response): Promise<{
  code: string;
  message: string;
  fields?: Record<string, string>;
  details: Record<string, unknown>;
}> {
  const body = await json<{
    error: {
      code: string;
      message: string;
      fields?: Record<string, string>;
      details?: Record<string, unknown>;
      [key: string]: unknown;
    };
  }>(res);
  const { code, message, fields, details, ...flat } = body.error;
  return { code, message, fields, details: details ?? flat };
}

/**
 * The live (not-expired) cookies a response sets, as a Cookie header. An
 * expired cookie is a deletion, not a session — and that is an attribute, so
 * it has to be read off the full header rather than the name=value the header
 * is truncated to below.
 */
export function sessionCookies(res: Response): string {
  return res.headers
    .getSetCookie()
    .filter((raw) => !raw.split("; ").some((attr) => /^max-age=0$/i.test(attr)))
    .map((c) => c.split(";")[0])
    .join("; ");
}

/**
 * Sign up through the auth mount; returns everything a client would hold. The
 * label only orientates a failure: it names the user and keeps the address
 * unique per run, per suite.
 */
export async function signUp(
  label: string,
): Promise<{ email: string; cookies: string; token?: string }> {
  const slug = label.toLowerCase();
  const email = `${slug}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const res = await req("POST", "/api/auth/sign-up/email", {
    body: { email, password: `${slug}-pass-12345`, name: `${label} Test` },
  });
  expect(res.status).toBe(200);
  const body = await json<{ token?: string }>(res);
  return { email, cookies: sessionCookies(res), token: body.token };
}

/** Sign up, then read /api/v1/me: the session owner a route test needs. */
export async function freshUser(
  label: string,
): Promise<{ email: string; cookies: string; userId: string }> {
  const user = await signUp(label);
  const me = await json<{ id: string }>(
    await req("GET", "/api/v1/me", { cookies: user.cookies }),
  );
  return { ...user, userId: me.id };
}
