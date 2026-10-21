// Invitation mail: the one relationship notice an owner can send. It names
// the inviter and the collection in full, carries a single call to action to
// the invite path the route built, and states the offer's seven-day,
// single-use life.
//
// Both names are user-controlled. The layout escapes them in the HTML; the
// subject is flattened of CR/LF and control characters, and the collection
// name is cut to the subject budget while the body keeps it whole. The
// greeting is the anonymous `Hi,` because only the invitee's address is known.

import type { ComposedMail } from "../provider";
import { renderMail } from "./layout";
import { flattenSubject, greeting, truncateSubjectPart } from "./text";

export interface InvitationMailFacts {
  to: string;
  /** The owner's display name, as the access read names them. */
  inviterName: string;
  /** The collection's title, in full. */
  collectionName: string;
  /** The invite link, already on CLIENT_ORIGIN — the composer mints none. */
  url: string;
}

/** Both create and resend build through this function, so the second mail
 *  cannot drift from the first. */
export function invitationMail(facts: InvitationMailFacts): ComposedMail {
  // The subject gets the flattened inviter and a short collection name; the
  // body gets both values exactly as written (escaped by the renderer).
  const inviter = flattenSubject(facts.inviterName);
  const collection = flattenSubject(facts.collectionName);
  const parts = renderMail({
    preheader: `${inviter} invited you to collaborate on ${collection} on Arcula.`,
    heading: `${facts.inviterName} invited you to ${facts.collectionName}`,
    lines: [
      greeting(),
      `You have been invited to collaborate on the collection "${facts.collectionName}" on Arcula.`,
      "This invitation expires in seven days and can be used once.",
    ],
    cta: { label: "Accept invitation", url: facts.url },
    reason: `${facts.inviterName} asked Arcula to send this invitation. If you were not expecting it, reply to this email to reach a person.`,
  });

  return {
    to: facts.to,
    subject: `${inviter} invited you to ${truncateSubjectPart(facts.collectionName)} on Arcula`,
    text: parts.text,
    html: parts.html,
    tags: [{ name: "type", value: "invitation" }],
  };
}
