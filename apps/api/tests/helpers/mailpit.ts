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
