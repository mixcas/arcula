// Invitation mail: the relationship notice an owner sends. It names the inviter
// and the collection in full, carries a single call to action to the invite
// path the route built, and states the offer's real life.
//
// Both names are user-controlled. The layout escapes them in the HTML; the
// subject is flattened of CR/LF and control characters, and the collection
// name is cut to the subject budget while the body keeps it whole. The greeting
// is the anonymous `Hi,` because only the invitee's address is known.

import { INVITATION_TTL_MS } from "@arcula/shared";
import type { ComposedMail } from "../provider";
import { renderMail } from "./layout";
import { mailTag } from "./tag";
import { collectionOnArcula, flattenSubject, greeting } from "./text";

/** The offer's life in days, read from the one duration the route enforces so
 *  the copy cannot outlive a change to the TTL. */
const INVITATION_DAYS = Math.round(INVITATION_TTL_MS / (24 * 60 * 60 * 1000));

export interface InvitationMailFacts {
  to: string;
  /** The owner's display name, as the access read names them. */
  inviterName: string;
  /** The collection's title, in full. */
  collectionName: string;
  /** The invite link, already on CLIENT_ORIGIN — the composer mints none. */
  url: string;
  /** Whether a reply reaches a person: only then does the footer offer a
   *  reply, so it never promises a path that is not there. */
  hasReplyPath: boolean;
}

/** Both create and resend build through this function, so the second mail
 *  cannot drift from the first. */
export function invitationMail(facts: InvitationMailFacts): ComposedMail {
  // The subject gets the flattened inviter and a short collection name; the
  // body gets both values exactly as written (escaped by the renderer).
  const inviter = flattenSubject(facts.inviterName);
  const collection = flattenSubject(facts.collectionName);
  const reply = facts.hasReplyPath
    ? " If you were not expecting it, reply to this email to reach a person."
    : " If you were not expecting it, you can ignore this email.";
  const parts = renderMail({
    preheader: `${inviter} invited you to collaborate on ${collection} on Arcula.`,
    heading: `${facts.inviterName} invited you to ${facts.collectionName}`,
    lines: [
      greeting(),
      `You have been invited to collaborate on the collection "${facts.collectionName}" on Arcula.`,
      `This invitation expires in ${INVITATION_DAYS} days and can be used once.`,
    ],
    cta: { label: "Accept invitation", url: facts.url },
    reason: `${facts.inviterName} asked Arcula to send this invitation.${reply}`,
  });

  return {
    to: facts.to,
    subject: `${inviter} invited you to ${collectionOnArcula(facts.collectionName)}`,
    text: parts.text,
    html: parts.html,
    tags: [mailTag("invitation")],
  };
}
