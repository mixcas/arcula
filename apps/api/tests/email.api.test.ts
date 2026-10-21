// API integration: the mail provider and the reset/verification hooks —
// "Reset — fully live in beta" and the built-but-gated verification.
//
// The sink is the local Mailpit, read through its REST API (:8025) — the
// same inbox a developer opens in the UI. The app is driven in-process
// with app.request(); the SMTP hop to Mailpit is the only wire involved.
// .env is sourced by the test script, so EMAIL_FROM / CLIENT_ORIGIN here
// are the dev values.

import { client, closeDb } from "../src/db";
import { createEmailProvider } from "../src/email/provider";
import { passwordResetMail } from "../src/email/compose";
import { afterAll, describe, expect, it } from "vitest";
import { json, req, signUp } from "./helpers/api";
import {
  headerValue,
  mailpitHeaders,
  mailpitHtml,
  mailpitMessages,
  mailpitText,
  waitForMail,
} from "./helpers/mailpit";

const ORIGIN = "http://localhost:3000";

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

describe("the envelope every send wears", () => {
  it("normalises a bare sender and applies the configured Reply-To", async () => {
    const to = `envelope-${Date.now()}@example.test`;
    const provider = createEmailProvider("mailpit", {
      EMAIL_FROM: "bare@arcula.test",
      EMAIL_REPLY_TO: "Arcula <hello@arcula.test>",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
    });
    await provider.send(
      passwordResetMail({
        to,
        firstName: "Ada",
        url: `${ORIGIN}/reset-password/token`,
      }),
    );

    const mail = await waitForMail(to);
    // Configured bare, sent as Arcula — never an anonymous relay.
    expect(mail.From).toEqual({ Name: "Arcula", Address: "bare@arcula.test" });
    expect(mail.ReplyTo[0]).toEqual({
      Name: "Arcula",
      Address: "hello@arcula.test",
    });

    const parts = await mailpitText(mail.ID);
    expect(parts).toContain("Hi Ada,");
    expect(parts).toContain(`${ORIGIN}/reset-password/token`);
    const html = await mailpitHtml(mail.ID);
    expect(html).toContain(`src="${ORIGIN}/arcula-name-logo.png"`);
    expect(html).toContain('alt="Arcula"');
    expect(html).toContain(`href="${ORIGIN}/reset-password/token"`);

    const headers = await mailpitHeaders(mail.ID);
    expect(headerValue(headers, "X-Entity-Ref-ID")).toHaveLength(1);
    expect(headerValue(headers, "Auto-Submitted")).toEqual(["auto-generated"]);
    expect(headerValue(headers, "Reply-To")).toEqual([
      "Arcula <hello@arcula.test>",
    ]);
  }, 15000);

  it("sends no Reply-To header when EMAIL_REPLY_TO is unset", async () => {
    const to = `noreply-${Date.now()}@example.test`;
    const provider = createEmailProvider("mailpit", {
      EMAIL_FROM: "bare@arcula.test",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
    });
    await provider.send(
      passwordResetMail({ to, url: `${ORIGIN}/reset-password/token` }),
    );

    const mail = await waitForMail(to);
    expect(mail.ReplyTo).toEqual([]);
    expect(
      headerValue(await mailpitHeaders(mail.ID), "Reply-To"),
    ).toBeUndefined();
  }, 15000);
});

describe("password reset — live (fully live in beta)", () => {
  it("mails a link on the CLIENT_ORIGIN that resets the password", async () => {
    const { email } = await signUp("s4");

    const asked = await req("POST", "/api/auth/request-password-reset", {
      body: { email },
    });
    expect(asked.status).toBe(200);

    const mail = await waitForMail(email);
    // The configured sender, with the product's display name on it: a bare
    // EMAIL_FROM is normalised, never sent as an anonymous address.
    const configured = process.env.EMAIL_FROM ?? "";
    const address = configured.match(/<([^>]+)>/)?.[1] ?? configured.trim();
    expect(mail.From.Address).toBe(address);
    expect(mail.From.Name).toBe("Arcula");
    expect(mail.Subject).toContain("Reset your Arcula password");

    // The link lands on the web app (CLIENT_ORIGIN), not the API — the
    // web app is what renders the reset form.
    const text = await mailpitText(mail.ID);
    const url = text.match(/http:\/\/\S+/)?.[0];
    expect(url, "the mail carries a link").toBeDefined();
    expect(new URL(url!).origin).toBe("http://localhost:3000");

    // The HTML twin carries the same URL behind the button, and the
    // wordmark from our own origin — no off-domain asset, no pixel.
    const html = await mailpitHtml(mail.ID);
    expect(html).toContain(`href="${url!.replace(/&/g, "&amp;")}"`);
    expect(html).toContain('src="http://localhost:3000/arcula-name-logo.png"');
    expect(html).toContain('alt="Arcula"');

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
      body: { email, password: "test-pass-12345" },
    });
    expect(oldIn.status).toBe(401);
  }, 30000);
});

describe("email verification — built but gated", () => {
  it("stays gated: the wired hook sends nothing at sign-up", async () => {
    const { email } = await signUp("s4");

    // The hook is configured, so if the auto-send gate (sendOnSignUp ??
    // requireEmailVerification) were ever flipped, this would catch it:
    // a background send lands within milliseconds. The assertion is per
    // address, not the whole inbox — another suite is sending mail too.
    await new Promise((r) => setTimeout(r, 1000));
    const forThisAddress = (await mailpitMessages()).filter(
      (m) => m.To[0]?.Address === email,
    );
    expect(forThisAddress, "no mail at sign-up").toHaveLength(0);
  }, 15000);

  it("the on-demand endpoint mails a CLIENT_ORIGIN link that verifies the account", async () => {
    const { email, cookies } = await signUp("s4");

    const sent = await req("POST", "/api/auth/send-verification-email", {
      cookies,
      body: { email },
    });
    expect(sent.status).toBe(200);
    expect((await json<{ status: boolean }>(sent)).status).toBe(true);

    const mail = await waitForMail(email);
    expect(mail.Subject).toContain("Verify your Arcula email");
    expect(mail.From.Name).toBe("Arcula");

    const text = await mailpitText(mail.ID);
    const url = text.match(/http:\/\/\S+/)?.[0];
    expect(url, "the mail carries a link").toBeDefined();
    expect(new URL(url!).origin).toBe("http://localhost:3000");

    const html = await mailpitHtml(mail.ID);
    expect(html).toContain(`href="${url!.replace(/&/g, "&amp;")}"`);
    expect(html).toContain('alt="Arcula"');

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
