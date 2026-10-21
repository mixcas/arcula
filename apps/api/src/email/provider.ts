// The mail provider: the only place that talks to Mailpit or Resend. Copy is
// composed elsewhere (`./compose`), so this file is transport and envelope.
//
//   mailpit (local) — nodemailer over SMTP to Mailpit, the inbox you
//                     actually read in dev (SMTP on :1025, UI on :8025).
//                     Nothing local bills.
//   resend (prod)   — a plain fetch to the Resend API: one POST endpoint,
//                     and the SDK was ruled out (a dependency with its own
//                     transitive pins for a single call).
//
// Chosen by EMAIL_PROVIDER; anything else is a config error, not a
// silent fallback.

import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { normalizeSender } from "./compose/text";
import { replyToFor, resendPayload, sendHeaders } from "./payload";

// The links the mails carry live in their own module so the composer can use
// them without building a provider; re-exported here because every call site
// that has one also has this file open.
export { clientLink, clientUrl } from "./links";

/** A Resend tag: what the dashboard's insights group by. */
export interface EmailTag {
  name: string;
  value: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** The HTML twin. Every composed Arcula mail has one; it stays optional
   *  here only so a transport-level caller cannot be forced through the
   *  composer. */
  html?: string;
  /** This message's Reply-To, overriding the configured EMAIL_REPLY_TO. The
   *  type is `string | null`: `undefined` means "use the configured one", an
   *  explicit `null` means "send none". */
  replyTo?: string | null;
  /** Extra headers. The two every send carries are added by the provider and
   *  win over a value here. */
  headers?: Record<string, string>;
  /** Resend tags — the composer sets the `type` tag. */
  tags?: EmailTag[];
}

export interface EmailProvider {
  readonly id: "mailpit" | "resend";
  send(message: EmailMessage): Promise<void>;
}

/** What a composer builder returns: both parts are always present, because
 *  the layout emits them together. The provider's message type keeps `html`
 *  optional so transport-level callers are not forced through the composer. */
export interface ComposedMail extends EmailMessage {
  html: string;
}

class MailpitEmail implements EmailProvider {
  readonly id = "mailpit" as const;
  private readonly transporter: Transporter;

  constructor(
    host: string,
    port: number,
    private readonly from: string,
    private readonly replyTo: string | null,
  ) {
    // Mailpit is a local dev sink: open SMTP, no TLS, no credentials.
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
    });
  }

  async send(message: EmailMessage) {
    const headers = sendHeaders(message, randomUUID());
    const replyTo = replyToFor(message, this.replyTo);
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(replyTo ? { replyTo } : {}),
      headers,
    });
  }
}

class ResendEmail implements EmailProvider {
  readonly id = "resend" as const;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly replyTo: string | null,
  ) {}

  async send(message: EmailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(resendPayload(message, this.from, this.replyTo)),
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
  if (!env.EMAIL_FROM) throw new Error("EMAIL_FROM is required to send mail");
  // A configured sender is normalised rather than trusted: `noreply@arcula.art`
  // would reach a recipient as an anonymous relay, which is the shape this
  // work exists to remove.
  const from = normalizeSender(env.EMAIL_FROM);
  const replyTo = env.EMAIL_REPLY_TO?.trim()
    ? normalizeSender(env.EMAIL_REPLY_TO)
    : null;
  switch (key) {
    case "mailpit":
      return new MailpitEmail(
        env.SMTP_HOST ?? "localhost",
        Number(env.SMTP_PORT ?? 1025),
        from,
        replyTo,
      );
    case "resend":
      if (!env.RESEND_API_KEY) {
        throw new Error(
          "RESEND_API_KEY is required when EMAIL_PROVIDER=resend",
        );
      }
      return new ResendEmail(env.RESEND_API_KEY, from, replyTo);
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
