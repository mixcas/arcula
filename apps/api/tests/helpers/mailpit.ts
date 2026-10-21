// The local Mailpit sink, read through its REST API (:8025) — the same inbox a
// developer opens in the UI. A suite finds its own message by the unique
// address it sent to; it never clears the shared inbox, because another test
// file is reading it at the same time.

const MAILPIT = "http://127.0.0.1:8025";

// Mailpit's REST API is PascalCase; the list gives snippets, the
// single-message endpoint gives the full plain-text body.
export type MailpitMessage = {
  ID: string;
  From: { Name: string; Address: string };
  To: Array<{ Name: string; Address: string }>;
  Subject: string;
};

export async function mailpitMessages(): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT}/api/v1/messages?start=0`);
  const body = (await res.json()) as { messages: MailpitMessage[] };
  return body.messages;
}

export async function mailpitText(id: string): Promise<string> {
  const res = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  const body = (await res.json()) as { Text: string };
  return body.Text;
}

/** The delivered message in full: headers and both parts. The list endpoint
 *  carries snippets only, so a test that reads the HTML twin asks here. */
export type MailpitFullMessage = MailpitMessage & {
  Text: string;
  HTML: string;
};

export async function mailpitMessage(id: string): Promise<MailpitFullMessage> {
  const res = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  return (await res.json()) as MailpitFullMessage;
}

/** Poll until a message for `to` appears (Mailpit delivers in ms locally). */
export async function waitForMail(
  to: string,
  timeoutMs = 8000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = (await mailpitMessages()).find(
      (m) => m.To[0]?.Address.toLowerCase() === to.toLowerCase(),
    );
    if (found) return found;
    if (Date.now() > deadline) {
      throw new Error(`no mail for ${to} within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** The one http(s) link in a plain-text mail. */
export function linkIn(text: string): URL {
  const match = text.match(/https?:\/\/\S+/);
  if (!match) throw new Error("the mail carries no link");
  return new URL(match[0]);
}

/** Every message addressed to `to`, newest first (Mailpit's own order). */
export function mailsFor(to: string): Promise<MailpitMessage[]> {
  return mailpitMessages().then((all) =>
    all.filter((m) => m.To[0]?.Address.toLowerCase() === to.toLowerCase()),
  );
}

/**
 * Poll until a message for `to` arrives that is not one of `seen`. A resend
 * mails the same address again, so the second delivery is only visible by
 * comparing ids — `waitForMail` would keep answering with the first one.
 */
export async function waitForNewMail(
  to: string,
  seen: Iterable<string> = [],
  timeoutMs = 8000,
): Promise<MailpitMessage> {
  const known = new Set(seen);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = (await mailsFor(to)).find((m) => !known.has(m.ID));
    if (found) return found;
    if (Date.now() > deadline) {
      throw new Error(`no new mail for ${to} within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
