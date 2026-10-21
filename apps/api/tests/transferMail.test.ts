// Pure: the ownership-transfer mail. These read the message a new owner
// receives — subject, both parts, the link and the greeting — not the route
// that sends it.

import { describe, expect, it } from "vitest";
import { ownershipTransferMail } from "../src/email/compose";
import { urlsIn } from "./helpers/html";

const ORIGIN = "http://localhost:3000";
const MANAGE = `${ORIGIN}/manage/collection/summer-in-lisbon-abc123`;

const facts = {
  to: "ada@example.test",
  firstName: "Ada",
  collectionName: "Summer in Lisbon",
  previousOwnerName: "Grace Hopper",
  url: MANAGE,
};

describe("ownership transfer mail", () => {
  it("names the collection in the subject and both parts", () => {
    const mail = ownershipTransferMail(facts);

    expect(mail.subject).toBe("You now own Summer in Lisbon on Arcula");
    expect(mail.text).toContain('"Summer in Lisbon"');
    expect(mail.html).toContain("&quot;Summer in Lisbon&quot;");
    expect(mail.tags).toEqual([{ name: "type", value: "transfer" }]);
  });

  it("points the button and the visible URL at the manage page", () => {
    const { text, html } = ownershipTransferMail(facts);

    expect(text).toContain(`Open collection: ${MANAGE}`);
    expect(html).toContain(`href="${MANAGE}"`);
    expect(html).toContain(`>${MANAGE}</a>`);
    expect(html).toContain(`src="${ORIGIN}/arcula-name-logo.png"`);
    expect(html).toContain('alt="Arcula"');
  });

  it("says the previous owner stays a collaborator", () => {
    const { text, html } = ownershipTransferMail(facts);

    expect(text).toContain("previous owner stays on as a collaborator");
    expect(html).toContain("previous owner stays on as a collaborator");
  });

  it("greets by first name, escaping a hostile one", () => {
    const hostile = `<b>Ada</b> & "friends"`;
    const mail = ownershipTransferMail({ ...facts, firstName: hostile });

    expect(mail.text).toContain('Hi <b>Ada</b> & "friends",');
    expect(mail.html).not.toContain("<b>Ada</b>");
    expect(mail.html).toContain(
      "Hi &lt;b&gt;Ada&lt;/b&gt; &amp; &quot;friends&quot;,",
    );
  });

  it("falls back to a neutral greeting when no first name is stored", () => {
    const mail = ownershipTransferMail({ ...facts, firstName: null });
    expect(mail.text).toContain("Hi,");
    expect(mail.html).toContain("Hi,");
  });

  it("truncates a long collection name in the subject and keeps it whole in the body", () => {
    const collectionName = `A collection with a deliberately long name ${"x".repeat(30)}`;
    const mail = ownershipTransferMail({ ...facts, collectionName });
    const subjectName = mail.subject.slice(
      "You now own ".length,
      mail.subject.length - " on Arcula".length,
    );

    expect(subjectName).toHaveLength(40);
    expect(subjectName.endsWith("…")).toBe(true);
    // The body never loses a character the owner typed.
    expect(mail.text).toContain(collectionName);
    expect(mail.html).toContain(collectionName);
  });

  it("flattens a newline out of the name so no header can be forged", () => {
    const mail = ownershipTransferMail({
      ...facts,
      collectionName: "Wall\r\nBcc: evil@example.test",
    });

    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toContain("Wall Bcc: evil@example.test");
  });

  it("carries no tracking pixel and no off-domain asset", () => {
    const { html } = ownershipTransferMail(facts);
    expect(html.match(/<img/g)).toHaveLength(1);
    const offDomain = urlsIn(html).filter(
      (url) => !url.startsWith(`${ORIGIN}/`),
    );
    expect(offDomain).toEqual([]);
  });
});
