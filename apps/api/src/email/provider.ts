// The mail provider behind Better Auth's two hooks (plan §5):
// `emailAndPassword.sendResetPassword` and
// `emailVerification.sendVerificationEmail`.
//
//   mailpit (local) — nodemailer over SMTP to Mailpit, the inbox you
//                     actually read in dev (SMTP on :1025, UI on :8025).
//                     Nothing local bills.
//   resend (prod)   — a plain fetch to the Resend API: one POST endpoint,
//                     and the SDK was ruled out (a dependency with its own
//                     transitive pins for a single call, §15).
//
// Chosen by EMAIL_PROVIDER; anything else is a config error, not a
// silent fallback.

import nodemailer, { type Transporter } from "nodemailer";
import { clientOrigin } from "../env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly id: "mailpit" | "resend";
  send(message: EmailMessage): Promise<void>;
}

// Better Auth's hook URLs point at the API origin; the links in the mails
// have to land on the web app that renders the reset/verification forms,
// so the origin is rewritten to CLIENT_ORIGIN (§9) — path and query stay.
export function clientUrl(apiUrl: string): string {
  if (!clientOrigin) {
    throw new Error(
      "CLIENT_ORIGIN is not set; the reset/verification mails cannot point at the web app.",
    );
  }
  // url.origin is not assignable in every runtime (Bun's is a read-only
  // accessor), so rebuild from the parts instead.
  const url = new URL(apiUrl);
  return `${clientOrigin}${url.pathname}${url.search}${url.hash}`;
}

class MailpitEmail implements EmailProvider {
  readonly id = "mailpit" as const;
  private readonly from: string;
  private readonly transporter: Transporter;

  constructor(host: string, port: number, from: string) {
    this.from = from;
    // Mailpit is a local dev sink: open SMTP, no TLS, no credentials.
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
    });
  }

  async send(message: EmailMessage) {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

class ResendEmail implements EmailProvider {
  readonly id = "resend" as const;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Resend rejected the mail (${res.status}): ${await res.text()}`,
      );
    }
  }
}

export function createEmailProvider(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): EmailProvider {
  const from = env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is required to send mail");
  switch (key) {
    case "mailpit":
      return new MailpitEmail(
        env.SMTP_HOST ?? "localhost",
        Number(env.SMTP_PORT ?? 1025),
        from,
      );
    case "resend":
      if (!env.RESEND_API_KEY) {
        throw new Error(
          "RESEND_API_KEY is required when EMAIL_PROVIDER=resend",
        );
      }
      return new ResendEmail(env.RESEND_API_KEY, from);
    default:
      throw new Error(
        `EMAIL_PROVIDER must be "mailpit" or "resend", got "${key}"`,
      );
  }
}

// Read once at import, like the rest of the config; tests that need a
// different provider build their own via createEmailProvider.
export const emailProvider: EmailProvider = createEmailProvider(
  process.env.EMAIL_PROVIDER ?? "mailpit",
);
