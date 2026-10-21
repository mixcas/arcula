// Pure: the shared mail composer. These tests read the message a recipient
// would receive — subject, HTML, text, tags — and the two transforms that make
// user-controlled facts safe and short enough for a subject line.

import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  flattenSubject,
  normalizeSender,
  truncateSubjectPart,
} from "../src/email/compose/text";
import { passwordResetMail, verificationMail } from "../src/email/compose";
import { resendPayload } from "../src/email/payload";
import type { EmailMessage } from "../src/email/provider";
import { urlsIn } from "./helpers/html";

const ORIGIN = "http://localhost:3000";
const RESET_URL = `${ORIGIN}/reset-password/token-123`;

describe("escapeHtml", () => {
  it("neutralises every character that can break out of text or an attribute", () => {
    expect(escapeHtml(`<script>alert("x & y")</script>'`)).toBe(
      "&lt;script&gt;alert(&quot;x &amp; y&quot;)&lt;/script&gt;&#39;",
    );
  });

  it("escapes the ampersand first, so entities are not double-decoded", () => {
    expect(escapeHtml("&lt;b&gt;")).toBe("&amp;lt;b&amp;gt;");
  });
});

describe("flattenSubject", () => {
  it("strips CR/LF and control characters, so no header can be forged", () => {
    expect(flattenSubject("Carlos\r\nBcc: evil@example.test")).toBe(
      "Carlos Bcc: evil@example.test",
    );
    expect(flattenSubject("a\u0000b")).toBe("a b");
  });

  it("collapses runs of whitespace and trims the ends", () => {
    expect(flattenSubject("  a \t  b  ")).toBe("a b");
  });
});

describe("truncateSubjectPart", () => {
  it("shortens a long collection name to 40 characters with an ellipsis", () => {
    const long = "A".repeat(60);
    const short = truncateSubjectPart(long);
    expect(short).toHaveLength(40);
    expect(short.endsWith("…")).toBe(true);
    expect(short).toBe(`${"A".repeat(39)}…`);
  });

  it("leaves a name that already fits alone", () => {
    expect(truncateSubjectPart("Summer in Lisbon")).toBe("Summer in Lisbon");
    expect(truncateSubjectPart("B".repeat(40))).toBe("B".repeat(40));
  });

  it("flattens before it measures, so a newline cannot slip in", () => {
    expect(truncateSubjectPart("Short\nname")).toBe("Short name");
  });

  it("counts characters, not UTF-16 units, so an emoji is never cut in half", () => {
    const name = `${"a".repeat(38)}😀${"b".repeat(5)}`;
    const short = truncateSubjectPart(name);

    expect([...short]).toHaveLength(40);
    expect(short.endsWith("…")).toBe(true);
    // A lone surrogate would make the subject invalid UTF-8 on the wire.
    expect(short).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(short).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(short).toContain("😀");
  });
});

describe("normalizeSender", () => {
  it("gives a bare address the Arcula display name", () => {
    expect(normalizeSender("noreply@arcula.art")).toBe(
      "Arcula <noreply@arcula.art>",
    );
    expect(normalizeSender("  noreply@arcula.art  ")).toBe(
      "Arcula <noreply@arcula.art>",
    );
  });

  it("preserves an explicit display name", () => {
    expect(normalizeSender("Arcula dev <noreply@dev.arcula.art>")).toBe(
      "Arcula dev <noreply@dev.arcula.art>",
    );
    expect(normalizeSender("  Arcula <noreply@arcula.art> ")).toBe(
      "Arcula <noreply@arcula.art>",
    );
  });

  it("refuses an empty sender instead of inventing one", () => {
    expect(() => normalizeSender("   ")).toThrow();
  });
});

// --- The two account mails and the transport payload ---------------------
//
// These read what a recipient receives: the parts, the call to action, the
// identity in the HTML and the fields Resend would receive.

describe("password reset mail", () => {
  it("carries the same facts in both parts", () => {
    const mail = passwordResetMail({
      to: "ada@example.test",
      firstName: "Ada",
      url: RESET_URL,
    });

    expect(mail.text).toContain("Hi Ada,");
    expect(mail.text).toContain(`Reset password: ${RESET_URL}`);
    expect(mail.text).toContain("your password stays unchanged");
    expect(mail.html).toContain("Hi Ada,");
    expect(mail.html).toContain(`href="${RESET_URL}"`);
    expect(mail.html).toContain(RESET_URL);
    expect(mail.html).toContain("your password stays unchanged");
    expect(mail.tags).toEqual([{ name: "type", value: "reset" }]);
  });

  it("puts the hosted wordmark, and only the wordmark, on our own origin", () => {
    const { html } = passwordResetMail({ to: "a@b.test", url: RESET_URL });

    expect(html).toContain(
      `<img src="${ORIGIN}/arcula-name-logo.png" width="160" height="42" alt="Arcula"`,
    );
    // No tracking pixel: the logo is the only image in the message.
    expect(html.match(/<img/g)).toHaveLength(1);
    // No remote stylesheet or webfont.
    expect(html).not.toContain("<link");
    expect(html).not.toContain("@import");
    expect(html).not.toContain("fonts.googleapis");
    // Every URL the message emits is on the web app's origin.
    const offDomain = urlsIn(html).filter(
      (url) => !url.startsWith(`${ORIGIN}/`),
    );
    expect(offDomain).toEqual([]);
  });

  it("greets anonymously when no first name is stored", () => {
    const mail = passwordResetMail({ to: "a@b.test", url: RESET_URL });
    expect(mail.text).toContain("Hi,");
    expect(mail.text).not.toContain("Hi ,");
  });

  it("escapes a hostile first name instead of rendering it", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const mail = passwordResetMail({
      to: "a@b.test",
      firstName: hostile,
      url: RESET_URL,
    });

    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    // The text part is not HTML, so it keeps the name as text — flattened to
    // one line, never as markup.
    expect(mail.text).toContain(hostile);
  });

  it("promises no opt-out, because there is none", () => {
    const mail = passwordResetMail({ to: "a@b.test", url: RESET_URL });
    for (const part of [mail.text, mail.html]) {
      expect(part).not.toMatch(/unsubscribe|opt[\s-]?out|email preferences/i);
    }
  });

  it("keeps the subject one line", () => {
    const { subject, html, text } = passwordResetMail({
      to: "a@b.test",
      firstName: "a\r\nBcc: evil@example.test",
      url: RESET_URL,
    });
    expect(subject).not.toMatch(/[\r\n]/);
    expect(html).toContain("a Bcc: evil@example.test");
    expect(text).toContain("a Bcc: evil@example.test");
  });
});

describe("verification mail", () => {
  it("carries the same facts in both parts, with its own tag", () => {
    const url = `${ORIGIN}/verify-email?token=abc`;
    const mail = verificationMail({ to: "a@b.test", url });

    expect(mail.subject).toBe("Verify your Arcula email");
    expect(mail.text).toContain(`Verify email: ${url}`);
    expect(mail.html).toContain(`href="${url}"`);
    expect(mail.text).toContain("the account stays as it is");
    expect(mail.html).toContain("the account stays as it is");
    expect(mail.tags).toEqual([{ name: "type", value: "verify" }]);
    expect(mail.html).toContain('alt="Arcula"');
  });
});

describe("resendPayload", () => {
  const message: EmailMessage = {
    to: "ada@example.test",
    subject: "Reset your Arcula password",
    text: "text part",
    html: "<p>html part</p>",
    tags: [{ name: "type", value: "reset" }],
  };

  it("maps every field Resend reads", () => {
    const body = resendPayload(
      message,
      "Arcula <noreply@arcula.art>",
      "Arcula <hello@arcula.art>",
      "ref-1",
    );

    expect(body).toMatchObject({
      from: "Arcula <noreply@arcula.art>",
      to: ["ada@example.test"],
      subject: "Reset your Arcula password",
      text: "text part",
      html: "<p>html part</p>",
      reply_to: "Arcula <hello@arcula.art>",
      tags: [{ name: "type", value: "reset" }],
    });
    const headers = body.headers as Record<string, string>;
    expect(headers["X-Entity-Ref-ID"]).toBe("ref-1");
    expect(headers["Auto-Submitted"]).toBe("auto-generated");
  });

  it("sends no Reply-To when none is configured, and still tags the send", () => {
    const body = resendPayload(message, "Arcula <noreply@arcula.art>", null);
    expect(body).not.toHaveProperty("reply_to");
    expect(body.headers).toHaveProperty("X-Entity-Ref-ID");
  });

  it("cannot be talked out of the two headers every send carries", () => {
    const body = resendPayload(
      {
        ...message,
        headers: {
          "Auto-Submitted": "no",
          "X-Entity-Ref-ID": "forged",
        },
      },
      "a@b.test",
      "Arcula <hello@arcula.test>",
      "ref-1",
    );
    const headers = body.headers as Record<string, string>;
    expect(headers["Auto-Submitted"]).toBe("auto-generated");
    expect(headers["X-Entity-Ref-ID"]).toBe("ref-1");
  });

  it("gives each send its own X-Entity-Ref-ID", () => {
    const first = resendPayload(message, "a@b.test", null);
    const second = resendPayload(message, "a@b.test", null);
    const refOf = (body: Record<string, unknown>) =>
      (body.headers as Record<string, string>)["X-Entity-Ref-ID"];

    expect(refOf(first)).toBeTruthy();
    expect(refOf(first)).not.toBe(refOf(second));
  });
});
