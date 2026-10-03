// API integration: the mail provider and the reset/verification hooks
// (Phase 2, plan §12) — "Reset — fully live in beta" (§5) and G6's
// built-but-gated verification.
//
// The sink is the local Mailpit, read through its REST API (:8025) — the
// same inbox a developer opens in the UI. The app is driven in-process
// with app.request() (the decision recorded in §15); the SMTP hop to
// Mailpit is the only wire involved. .env is sourced by the test script,
// so EMAIL_FROM / CLIENT_ORIGIN here are the dev values.

import { app } from "../src/app";
import { client, closeDb } from "../src/db";
import { createEmailProvider } from "../src/email/provider";
import { afterAll, describe, expect, it } from "vitest";

const API = "http://localhost:8000";
const ORIGIN = "http://localhost:3000";
const MAILPIT = "http://127.0.0.1:8025";

// --- Mailpit (its REST API is PascalCase; the list gives snippets, the
// --- single-message endpoint gives the full plain-text body)

type MailpitMessage = {
  ID: string;
  From: { Name: string; Address: string };
  To: Array<{ Name: string; Address: string }>;
  Subject: string;
};

async function mailpitMessages(): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT}/api/v1/messages?start=0`);
  const body = (await res.json()) as { messages: MailpitMessage[] };
  return body.messages;
}

async function mailpitClear(): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
}

async function mailpitText(id: string): Promise<string> {
  const res = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  const body = (await res.json()) as { Text: string };
  return body.Text;
}

/** Poll until a message for `to` appears (Mailpit delivers in ms locally). */
async function waitForMail(
  to: string,
  timeoutMs = 8000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = (await mailpitMessages()).find(
      (m) => m.To[0]?.Address === to,
    );
    if (found) return found;
    if (Date.now() > deadline) {
      throw new Error(`no mail for ${to} within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

// --- app helpers (same shape as auth.api.test.ts)

async function req(
  method: string,
  path: string,
  opts: { cookies?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.cookies) headers.Cookie = opts.cookies;
  return await app.request(`${API}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const unique = () =>
  `s4-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

async function signUp(): Promise<{ email: string; cookies: string }> {
  const email = unique();
  const res = await req("POST", "/api/auth/sign-up/email", {
    body: { email, password: "s4-pass-12345", name: "S4 Test" },
  });
  expect(res.status).toBe(200);
  const cookies = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.includes("Max-Age=0"))
    .join("; ");
  return { email, cookies };
}

afterAll(async () => {
  await closeDb();
});

describe("provider selection (offline)", () => {
  it("builds both providers and refuses anything else", () => {
    expect(
      createEmailProvider("mailpit", {
        EMAIL_FROM: "a@b.test",
      }).id,
    ).toBe("mailpit");
    expect(
      createEmailProvider("resend", {
        EMAIL_FROM: "a@b.test",
        RESEND_API_KEY: "k",
      }).id,
    ).toBe("resend");
    expect(() =>
      createEmailProvider("smtp", {
        EMAIL_FROM: "a@b.test",
      }),
    ).toThrow(/EMAIL_PROVIDER/);
    expect(() =>
      createEmailProvider("resend", {
        EMAIL_FROM: "a@b.test",
      }),
    ).toThrow(/RESEND_API_KEY/);
    expect(() => createEmailProvider("mailpit", {})).toThrow(/EMAIL_FROM/);
  });
});

describe("password reset — live (plan §5: fully live in beta)", () => {
  it("mails a link on the CLIENT_ORIGIN that resets the password", async () => {
    await mailpitClear();
    const { email } = await signUp();

    const asked = await req("POST", "/api/auth/request-password-reset", {
      body: { email },
    });
    expect(asked.status).toBe(200);

    const mail = await waitForMail(email);
    expect(mail.From.Address).toBe(process.env.EMAIL_FROM);
    expect(mail.Subject).toContain("Reset your Arcula password");

    // The link lands on the web app (CLIENT_ORIGIN), not the API — the
    // web app is what renders the reset form in Phase 4.
    const text = await mailpitText(mail.ID);
    const url = text.match(/http:\/\/\S+/)?.[0];
    expect(url, "the mail carries a link").toBeDefined();
    expect(new URL(url!).origin).toBe("http://localhost:3000");

    // 1.7.7 carries the token in the path: /reset-password/<token>.
    const token = new URL(url!).pathname.split("/").pop()!;
    const done = await req("POST", "/api/auth/reset-password", {
      body: { token, newPassword: "brand-new-67890" },
    });
    expect(done.status).toBe(200);
    expect((await json<{ status: boolean }>(done)).status).toBe(true);

    const newIn = await req("POST", "/api/auth/sign-in/email", {
      body: { email, password: "brand-new-67890" },
    });
    expect(newIn.status).toBe(200);
    const oldIn = await req("POST", "/api/auth/sign-in/email", {
      body: { email, password: "s4-pass-12345" },
    });
    expect(oldIn.status).toBe(401);
  }, 30000);
});

describe("email verification — built but gated (G6)", () => {
  it("stays gated: the wired hook sends nothing at sign-up", async () => {
    await mailpitClear();
    await signUp();

    // The hook is configured, so if the auto-send gate (sendOnSignUp ??
    // requireEmailVerification) were ever flipped, this would catch it:
    // a background send lands within milliseconds.
    await new Promise((r) => setTimeout(r, 1000));
    expect(await mailpitMessages(), "no mail at sign-up").toHaveLength(0);
  }, 15000);

  it("the on-demand endpoint mails a CLIENT_ORIGIN link that verifies the account", async () => {
    await mailpitClear();
    const { email, cookies } = await signUp();

    const sent = await req("POST", "/api/auth/send-verification-email", {
      cookies,
      body: { email },
    });
    expect(sent.status).toBe(200);
    expect((await json<{ status: boolean }>(sent)).status).toBe(true);

    const mail = await waitForMail(email);
    expect(mail.Subject).toContain("Verify your Arcula email");

    const text = await mailpitText(mail.ID);
    const url = text.match(/http:\/\/\S+/)?.[0];
    expect(url, "the mail carries a link").toBeDefined();
    expect(new URL(url!).origin).toBe("http://localhost:3000");

    const token = new URL(url!).searchParams.get("token")!;
    const verified = await req(
      "GET",
      `/api/auth/verify-email?token=${encodeURIComponent(token)}`,
    );
    expect(verified.status).toBe(200);

    const rows =
      await client`select "emailVerified" from "user" where "email" = ${email}`;
    expect(rows[0].emailVerified).toBe(true);
  }, 30000);
});
