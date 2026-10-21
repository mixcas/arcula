// The transport payload, built without a network call.
//
// This module exists so the envelope rules can be tested without importing the
// provider — importing it would build the process's provider singleton, and a
// test of "what Resend receives" should not need EMAIL_FROM set. It depends on
// nothing but the message shape.

import { randomUUID } from "node:crypto";
import type { EmailMessage } from "./provider";

/**
 * The headers every send carries. `X-Entity-Ref-ID` is per send so a mailbox
 * does not collapse unrelated mails into one conversation; `Auto-Submitted`
 * keeps vacation responders from replying to a robot. Both are written last, so
 * a message's own headers cannot replace them: the rule is the send's, not the
 * caller's.
 */
export function sendHeaders(
  message: EmailMessage,
  refId: string,
): Record<string, string> {
  return {
    ...message.headers,
    "Auto-Submitted": "auto-generated",
    "X-Entity-Ref-ID": refId,
  };
}

/**
 * Resend's request body. A wrong field name (`reply_to`, `headers`, `tags`) is
 * visible here in a unit test, without a live send. Recipients are a
 * one-element array in Resend's API and a string in ours; an empty `replyTo`
 * sends no header at all.
 */
export function resendPayload(
  message: EmailMessage,
  from: string,
  replyTo: string | null,
  refId: string = randomUUID(),
): Record<string, unknown> {
  return {
    from,
    to: [message.to],
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(replyTo ? { reply_to: replyTo } : {}),
    headers: sendHeaders(message, refId),
    ...(message.tags?.length ? { tags: message.tags } : {}),
  };
}
