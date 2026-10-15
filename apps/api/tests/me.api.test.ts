// API integration: /api/v1/me — the session middleware, the writable set,
// and the error envelope.
//
// Driven in-process with app.request() against the real stack, exactly
// as tests/auth.api.test.ts.

import { sessionUserSchema } from "@arcula/shared";
import { app } from "../src/app";
import { client, closeDb } from "../src/db";
import { afterAll, describe, expect, it } from "vitest";

const API = "http://localhost:8000";
const ORIGIN = "http://localhost:3000";

async function req(
  method: string,
  path: string,
  opts: { cookies?: string; bearer?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.cookies) headers.Cookie = opts.cookies;
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  headers.Origin = ORIGIN;
  return await app.request(`${API}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

type MeUser = {
  id: string;
  email: string;
  tier: string;
  firstName: string | null;
  lastName: string | null;
  settings: Record<string, unknown> | null;
  [key: string]: unknown;
};
type Envelope = {
  error: { code: string; message: string; fields?: Record<string, string> };
};

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Sign up through the auth mount; returns everything a client would hold. */
async function freshUser() {
  const email = `me-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const up = await req("POST", "/api/auth/sign-up/email", {
    body: { email, password: "me-pass-12345", name: "Me Test" },
  });
  expect(up.status).toBe(200);
  const body = await json<{ token?: string }>(up);
  const cookies = up.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.includes("Max-Age=0"))
    .join("; ");
  return { email, cookies, token: body.token! };
}

afterAll(async () => {
  await closeDb();
});

describe("GET /api/v1/me", () => {
  it("returns the session user with the custom fields, by cookie and by bearer", async () => {
    const u = await freshUser();

    const byCookie = await req("GET", "/api/v1/me", { cookies: u.cookies });
    expect(byCookie.status).toBe(200);
    const me = await json<MeUser>(byCookie);
    expect(me.email).toBe(u.email);
    expect(me.tier).toBe("free");
    expect(me.firstName).toBeNull();
    expect(me.settings).toBeNull();

    const byBearer = await req("GET", "/api/v1/me", { bearer: u.token });
    expect((await json<MeUser>(byBearer)).email).toBe(u.email);
  }, 15000);

  it("answers the unauthorized envelope without a session", async () => {
    const res = await req("GET", "/api/v1/me");
    expect(res.status).toBe(401);
    const err = await json<Envelope>(res);
    expect(err.error.code).toBe("unauthorized");
    expect(typeof err.error.message).toBe("string");
  }, 15000);

  // The sign-up page's seam: the custom fields ride the sign-up body as
  // additional fields, the DB default fills the tier, and /me serves all
  // of it back. Parsed through the client's wire contract on the way out,
  // so a serializer↔schema drift fails here instead of as a parse error in
  // the browser.
  it("lands a sign-up's custom fields on the user row and serves them with the tier default", async () => {
    const email = `me-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
    const up = await req("POST", "/api/auth/sign-up/email", {
      body: {
        name: "Nina Solar",
        email,
        password: "me-pass-12345",
        firstName: "Nina",
        lastName: "Solar",
      },
    });
    expect(up.status).toBe(200);
    const cookies = up.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter((c) => !c.includes("Max-Age=0"))
      .join("; ");

    const res = await req("GET", "/api/v1/me", { cookies });
    expect(res.status).toBe(200);
    const me = sessionUserSchema.parse(await json<unknown>(res));
    expect(me.email).toBe(email);
    expect(me.name).toBe("Nina Solar");
    expect(me.firstName).toBe("Nina");
    expect(me.lastName).toBe("Solar");
    expect(me.tier).toBe("free");
    expect(me.emailVerified).toBe(false);
  }, 15000);
});

describe("PATCH /api/v1/me", () => {
  it("writes the writable set and returns the updated user", async () => {
    const u = await freshUser();

    const res = await req("PATCH", "/api/v1/me", {
      cookies: u.cookies,
      body: {
        firstName: "Cassandra",
        lastName: "Nova",
        settings: { theme: "dark" },
      },
    });
    expect(res.status).toBe(200);
    const me = await json<MeUser>(res);
    expect(me.firstName).toBe("Cassandra");
    expect(me.lastName).toBe("Nova");
    expect(me.settings).toEqual({ theme: "dark" });

    // The DB row agrees, not just the response.
    const rows =
      await client`select "firstName", "lastName", "settings" from "user" where "email" = ${u.email}`;
    expect(rows[0].firstName).toBe("Cassandra");
    expect(rows[0].lastName).toBe("Nova");
    expect(rows[0].settings).toEqual({ theme: "dark" });
  }, 15000);

  it("rejects a patch that touches a server-managed field with field-not-writable, leaving the row untouched", async () => {
    const u = await freshUser();

    const res = await req("PATCH", "/api/v1/me", {
      cookies: u.cookies,
      body: { tier: "pro", firstName: "ShouldNotLand" },
    });
    expect(res.status).toBe(409);
    const err = await json<Envelope>(res);
    expect(err.error.code).toBe("field-not-writable");

    const rows =
      await client`select "tier", "firstName" from "user" where "email" = ${u.email}`;
    expect(rows[0].tier).toBe("free");
    expect(rows[0].firstName).toBeNull();
  }, 15000);

  it("rejects email the same way", async () => {
    const u = await freshUser();
    const res = await req("PATCH", "/api/v1/me", {
      cookies: u.cookies,
      body: { email: "someone-else@example.test" },
    });
    expect(res.status).toBe(409);
    expect((await json<Envelope>(res)).error.code).toBe("field-not-writable");
  }, 15000);

  it("answers 400 validation with the failed fields for a bad value", async () => {
    const u = await freshUser();
    const res = await req("PATCH", "/api/v1/me", {
      cookies: u.cookies,
      body: { firstName: 42 },
    });
    expect(res.status).toBe(400);
    const err = await json<Envelope>(res);
    expect(err.error.code).toBe("validation");
    expect(err.error.fields?.firstName).toBeTypeOf("string");
  }, 15000);

  it("answers the unauthorized envelope without a session", async () => {
    const res = await req("PATCH", "/api/v1/me", {
      body: { firstName: "Nobody" },
    });
    expect(res.status).toBe(401);
    expect((await json<Envelope>(res)).error.code).toBe("unauthorized");
  }, 15000);
});
