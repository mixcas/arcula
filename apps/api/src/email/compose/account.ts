// Account mail: the messages about an account's own identity and access —
// a password reset and an email verification. They are sent because the
// account holder (or someone claiming to be) asked for them, so they are never
// suppressed by a preference and carry no opt-out: promising one would promise
// a capability that does not exist.
//
// Names come from the account, so they are user-controlled and go through the
// layout's escaping like any other value.

import type { ComposedMail } from "../provider";
import type { MailCta } from "./layout";
import { renderMail } from "./layout";
import { mailTag, type MailType } from "./tag";
import { greeting } from "./text";

export interface AccountMailFacts {
  to: string;
  /** The account's stored first name, when there is one. */
  firstName?: string | null;
  /** The action link, already on CLIENT_ORIGIN. */
  url: string;
}

interface AccountMailCopy {
  subject: string;
  preheader: string;
  heading: string;
  /** The sentence after the greeting. */
  line: string;
  cta: MailCta;
  reason: string;
  tag: Extract<MailType, "reset" | "verify">;
}

function accountMail(
  facts: AccountMailFacts,
  copy: AccountMailCopy,
): ComposedMail {
  const parts = renderMail({
    preheader: copy.preheader,
    heading: copy.heading,
    lines: [greeting(facts.firstName), copy.line],
    cta: copy.cta,
    reason: copy.reason,
  });
  return {
    to: facts.to,
    subject: copy.subject,
    text: parts.text,
    html: parts.html,
    tags: [mailTag(copy.tag)],
  };
}

/** The reset link is the one Better Auth minted, rewritten onto the web app:
 *  the reset form is an SPA route. */
export function passwordResetMail(facts: AccountMailFacts): ComposedMail {
  return accountMail(facts, {
    subject: "Reset your Arcula password",
    preheader: "Choose a new password for your Arcula account.",
    heading: "Reset your Arcula password",
    line: "Use the button below to choose a new password for your Arcula account.",
    cta: { label: "Reset password", url: facts.url },
    reason:
      "If you did not ask for a password reset, ignore this email — your password stays unchanged.",
    tag: "reset",
  });
}

/** Verification is wired but not required in beta; the hook exists so the
 *  second message is as recognisable as the first when it is turned on. */
export function verificationMail(facts: AccountMailFacts): ComposedMail {
  return accountMail(facts, {
    subject: "Verify your Arcula email",
    preheader: "Confirm the email address on your Arcula account.",
    heading: "Verify your Arcula email",
    line: "Use the button below to confirm this address belongs to your Arcula account.",
    cta: { label: "Verify email", url: facts.url },
    reason:
      "If you did not create this account, ignore this email — the account stays as it is.",
    tag: "verify",
  });
}
