// API integration: the Lambda entry — the API Gateway
// event ↔ Request/Response conversions. The cases that matter are the
// ones that fail silently in production: a session cookie mangled by
// the Headers view's comma-join, or a binary answer delivered as text.
// Driven in-process by calling handler() with synthetic events — the
// same shape API Gateway delivers, so no gateway in the loop.

import { closeDb } from "../src/db";
import { CLIENT_ADDRESS_HEADER } from "../src/clientAddress";
import { gatewayHeaders, handler } from "../src/lambda";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const INDEX = "<html>FIXTURE-INDEX</html>";
const BINARY = "bin";

let distDir: string;

beforeAll(async () => {
  distDir = await mkdtemp(join(tmpdir(), "arcula-lambda-"));
  await mkdir(join(distDir, "assets"), { recursive: true });
  await writeFile(join(distDir, "index.html"), INDEX);
  await writeFile(join(distDir, "assets/blob.bin"), BINARY);
  process.env.WEB_DIST = distDir;
});

afterAll(async () => {
  delete process.env.WEB_DIST;
  await rm(distDir, { recursive: true, force: true });
  await closeDb();
});

interface GwOpts {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  cookies?: string[];
  rawQueryString?: string;
}

const gw = (path: string, opts: GwOpts = {}) => ({
  rawPath: path,
  rawQueryString: opts.rawQueryString ?? "",
  headers: { host: "smoke.local", ...(opts.headers ?? {}) },
  cookies: opts.cookies,
  body: opts.body,
  isBase64Encoded: false,
  requestContext: {
    http: { method: opts.method ?? "GET", path },
  },
});

const jsonBody = (body: unknown) => ({
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

const sessionCookie = (res: { cookies?: string[] }) => {
  const cookies = res.cookies ?? [];
  const session = cookies.find((c) =>
    c.startsWith("better-auth.session_token"),
  );
  expect(
    session,
    "a session cookie was returned, split, not comma-joined",
  ).toBeTruthy();
  return session!;
};

describe("the Lambda entry", () => {
  it("answers an API GET: the JSON body is plain text, not base64", async () => {
    const res = await handler(gw("/api/health"));
    expect(res.statusCode).toBe(200);
    expect(res.isBase64Encoded).toBe(false);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("passes the gateway's source address on, and never one the client supplied", () => {
    // The unlock throttle counts against this header, so a forged value must
    // not survive the adapter: API Gateway appends to a client-sent
    // `x-forwarded-for`, and a guesser who could name their own address would
    // simply mint a new one per attempt.
    const headers = gatewayHeaders({
      rawPath: "/api/health",
      headers: { host: "smoke.local", [CLIENT_ADDRESS_HEADER]: "203.0.113.99" },
      requestContext: {
        http: { method: "GET", path: "/api/health", sourceIp: "198.51.100.2" },
      },
    });
    expect(headers.get(CLIENT_ADDRESS_HEADER)).toBe("198.51.100.2");
  });

  it("serves the app shell as a text response", async () => {
    const res = await handler(gw("/"));
    expect(res.statusCode).toBe(200);
    expect(res.isBase64Encoded).toBe(false);
    expect(res.body).toBe(INDEX);
  });

  it("delivers a binary answer base64-encoded", async () => {
    const res = await handler(gw("/assets/blob.bin"));
    expect(res.statusCode).toBe(200);
    expect(res.isBase64Encoded).toBe(true);
    expect(Buffer.from(res.body, "base64").toString("latin1")).toBe(BINARY);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
  });

  it("sign-up: the body rides through, and the session cookie comes back in the cookies array (payload 2.0)", async () => {
    const email = `lambda-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
    const res = await handler(
      gw("/api/auth/sign-up/email", {
        method: "POST",
        ...jsonBody({
          name: "Lambda Smoke",
          email,
          password: "lambda-pass-123",
        }),
      }),
    );
    expect(res.statusCode).toBe(200);
    const signUpBody = JSON.parse(res.body) as { user: { email: string } };
    expect(signUpBody.user.email).toBe(email);

    // The whole point of the array: each Set-Cookie is its own entry. A
    // comma-joined string would still "contain" the token, so assert the
    // shape, not just the presence. (Payload format 2.0 has no
    // multiValueHeaders — an unknown field is dropped silently, which is
    // exactly how the session cookie vanished behind the gateway.)
    const cookies = res.cookies ?? [];
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie).toContain("better-auth.session_token");
      expect(cookie).not.toContain(", better-auth");
    }
    // The flat headers view must not also carry the cookies, or the
    // gateway would send them twice.
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("a session cookie in the event's cookies array reaches the app", async () => {
    const email = `lambda-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
    const up = await handler(
      gw("/api/auth/sign-up/email", {
        method: "POST",
        ...jsonBody({
          name: "Lambda Smoke",
          email,
          password: "lambda-pass-123",
        }),
      }),
    );
    expect(up.statusCode).toBe(200);

    const me = await handler(
      gw("/api/v1/me", { cookies: [sessionCookie(up)] }),
    );
    expect(me.statusCode).toBe(200);
    const meBody = JSON.parse(me.body) as { email: string };
    expect(meBody.email).toBe(email);
  });

  it("carries the query string through", async () => {
    // The health route ignores it, but a mangled rawQueryString would
    // throw building the URL — this is a construction check, not a
    // routing one.
    const res = await handler(gw("/api/health", { rawQueryString: "probe=1" }));
    expect(res.statusCode).toBe(200);
  });
});
