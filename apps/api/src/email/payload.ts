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
 * does not collapse unrelated transactional messages into one conversation;
 * `Auto-Submitted` keeps vacation responders from replying to a robot. Both are
 * written last, so a message's own headers cannot replace them: the rule is
 * the send's, not the caller's.
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

/** The Reply-To this message goes out with: its own when it states one (an
 *  explicit null suppresses the configured fallback), else the configured one,
 *  else none at all — an empty variable never invents an address. */
export function replyToFor(
  message: EmailMessage,
  fallback: string | null,
): string | null {
  return message.replyTo === undefined ? fallback : message.replyTo;
}

/**
 * Resend's request body. A wrong field name (`reply_to`, `headers`, `tags`) is
 * visible here in a unit test, without a live send. Recipients are a
 * one-element array in Resend's API and a string in ours.
 */
export function resendPayload(
  message: EmailMessage,
  from: string,
  replyTo: string | null,
  refId: string = randomUUID(),
): Record<string, unknown> {
  const to = replyToFor(message, replyTo);
  return {
    from,
    to: [message.to],
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(to ? { reply_to: to } : {}),
    headers: sendHeaders(message, refId),
    ...(message.tags?.length ? { tags: message.tags } : {}),
  };
}
