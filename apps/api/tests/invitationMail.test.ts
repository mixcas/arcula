// Pure: the invitation mail. These read the message an invitee receives —
// subject, both parts, the call to action and the footer reason — with the
// names of the person and the collection as the user-controlled facts they
// are. The composer is the seam: the route supplies facts, never copy.

import { describe, expect, it } from "vitest";
import { invitationMail } from "../src/email/compose";

const ORIGIN = "http://localhost:3000";
const INVITE_URL = `${ORIGIN}/invite/token-123`;

function urlsIn(html: string): string[] {
  return [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
}

/** CR, LF, NUL and the rest of the control range, plus DEL. */
function controlChars(value: string): string[] {
  return [...value].filter((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

describe("invitation mail", () => {
  it("names the inviter and the collection and carries the expiry in both parts", () => {
    const mail = invitationMail({
      to: "ada@example.test",
      inviterName: "Carlos",
      collectionName: "Summer in Lisbon",
      url: INVITE_URL,
    });

    expect(mail.subject).toBe(
      "Carlos invited you to Summer in Lisbon on Arcula",
    );
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain("Carlos");
      expect(part).toContain("Summer in Lisbon");
      expect(part).toContain("seven days");
      expect(part).toContain("once");
    }
    expect(mail.text).toContain(`Accept invitation: ${INVITE_URL}`);
    expect(mail.html).toContain(`href="${INVITE_URL}"`);
    expect(mail.text).toContain("Hi,");
    expect(mail.tags).toEqual([{ name: "type", value: "invitation" }]);
  });

  it("escapes hostile names in the HTML and keeps them whole in the text", () => {
    const inviterName = `Carlos <script>alert("x & y")</script>`;
    const collectionName = `Studio "Quotes" & <b>bold</b>\nsecond line`;
    const mail = invitationMail({
      to: "ada@example.test",
      inviterName,
      collectionName,
      url: INVITE_URL,
    });

    // No user markup reaches the HTML: every angle bracket and quote is an
    // entity, so the attacker cannot open a tag or close an attribute.
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<b>bold</b>");
    expect(mail.html).toContain(
      "Carlos &lt;script&gt;alert(&quot;x &amp; y&quot;)&lt;/script&gt;",
    );
    expect(mail.html).toContain(
      "Studio &quot;Quotes&quot; &amp; &lt;b&gt;bold&lt;/b&gt;",
    );

    // The text part is not HTML, so it keeps the names as they were written.
    expect(mail.text).toContain(inviterName);
    expect(mail.text).toContain(collectionName);

    // No name can forge a header, whatever it carries.
    expect(controlChars(mail.subject)).toEqual([]);
  });

  it("flattens the inviter and truncates a long collection name in the subject only", () => {
    const collectionName = "A".repeat(60);
    const mail = invitationMail({
      to: "ada@example.test",
      inviterName: "Carlos\r\nBcc: evil@example.test",
      collectionName,
      url: INVITE_URL,
    });

    expect(mail.subject).toBe(
      `Carlos Bcc: evil@example.test invited you to ${"A".repeat(39)}… on Arcula`,
    );
    expect(mail.subject).not.toMatch(/[\r\n]/);
    // The body has the whole name, not the shortened one.
    expect(mail.text).toContain(collectionName);
    expect(mail.html).toContain(collectionName);
  });

  it("puts the CTA, the visible URL and the wordmark on the client origin", () => {
    const { html, text } = invitationMail({
      to: "ada@example.test",
      inviterName: "Carlos",
      collectionName: "Summer in Lisbon",
      url: INVITE_URL,
    });

    expect(html).toContain(
      `<img src="${ORIGIN}/arcula-name-logo.png" width="160" height="42" alt="Arcula"`,
    );
    expect(html).toContain(`href="${INVITE_URL}"`);
    expect(html).toContain(`>${INVITE_URL}</a>`);
    expect(text).toContain(INVITE_URL);
    expect(urlsIn(html).filter((url) => !url.startsWith(`${ORIGIN}/`))).toEqual(
      [],
    );
  });

  it("explains why the mail arrived and offers a reply, without an opt-out it cannot keep", () => {
    const { html, text } = invitationMail({
      to: "ada@example.test",
      inviterName: "Carlos",
      collectionName: "Summer in Lisbon",
      url: INVITE_URL,
    });

    for (const part of [text, html]) {
      expect(part).toContain("asked Arcula to send");
      expect(part).toContain("reply to this email");
      expect(part).not.toMatch(/unsubscribe|opt[\s-]?out|email preferences/i);
    }
  });
});
