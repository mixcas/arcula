// The one tag shape every builder carries. Resend groups its insights by
// `{ name, value }`, and the value is the kind of mail — so the four builders
// share one definition instead of four hand-built literals.

import type { EmailTag } from "../provider";

/** The four kinds of mail Arcula sends. */
export type MailType = "reset" | "verify" | "invitation" | "transfer";

export function mailTag(type: MailType): EmailTag {
  return { name: "type", value: type };
}
