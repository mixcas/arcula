// Pure: the invitation mail. These read the message an invitee receives —
// subject, both parts, the call to action and the footer reason — with the
// names of the person and the collection as the user-controlled facts they
// are. The composer is the seam: the route supplies facts, never copy.

import { describe, expect, it } from "vitest";
import { INVITATION_TTL_MS } from "@arcula/shared";
import { invitationMail } from "../src/email/compose";
import { controlChars, urlsIn } from "./helpers/html";

const ORIGIN = "http://localhost:3000";
const INVITE_URL = `${ORIGIN}/invite/token-123`;
const DAYS = Math.round(INVITATION_TTL_MS / (24 * 60 * 60 * 1000));

describe("invitation mail", () => {
  it("names the inviter and the collection and carries the expiry in both parts", () => {
    const mail = invitationMail({
      to: "ada@example.test",
      inviterName: "Carlos",
      collectionName: "Summer in Lisbon",
      url: INVITE_URL,
      hasReplyPath: true,
    });

    expect(mail.subject).toBe(
      "Carlos invited you to Summer in Lisbon on Arcula",
    );
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain("Carlos");
      expect(part).toContain("Summer in Lisbon");
      // The stated life is the route's real TTL, not a word that can drift
      // from it.
      expect(part).toContain(`${DAYS} days`);
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
      hasReplyPath: true,
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
      hasReplyPath: true,
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
      hasReplyPath: true,
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

  it("offers a reply only when a reply reaches a person", () => {
    const facts = {
      to: "ada@example.test",
      inviterName: "Carlos",
      collectionName: "Summer in Lisbon",
      url: INVITE_URL,
      hasReplyPath: true,
    };
    const reachable = invitationMail(facts);
    const unreachable = invitationMail({ ...facts, hasReplyPath: false });

    for (const part of [reachable.text, reachable.html]) {
      expect(part).toContain("asked Arcula to send");
      expect(part).toContain("reply to this email");
      expect(part).not.toMatch(/unsubscribe|opt[\s-]?out|email preferences/i);
    }
    // The kill-switch case: no Reply-To, so no promise of a human on the other
    // end. The reason line is still there.
    for (const part of [unreachable.text, unreachable.html]) {
      expect(part).toContain("asked Arcula to send");
      expect(part).not.toContain("reply to this email");
      expect(part).not.toMatch(/unsubscribe|opt[\s-]?out|email preferences/i);
    }
  });
});
