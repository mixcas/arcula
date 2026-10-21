// The ownership-transfer notice: the one mail that tells a collaborator the
// collection is theirs now. It is relationship mail — sent because an existing
// relationship changed, not because the account asked — and, like the
// invitation, it carries no opt-out.
//
// The collection name and the previous owner's name are user-controlled, so
// they are escaped in the HTML and flattened before they reach the subject.

import type { ComposedMail } from "../provider";
import { renderMail } from "./layout";
import { greeting, truncateSubjectPart } from "./text";

export interface TransferMailFacts {
  to: string;
  /** The new owner's stored first name, when there is one. */
  firstName?: string | null;
  collectionName: string;
  /** How the account that handed the collection over is named. */
  previousOwnerName: string;
  /** The manage page on CLIENT_ORIGIN, already built by the route. */
  url: string;
}

export function ownershipTransferMail(facts: TransferMailFacts): ComposedMail {
  const parts = renderMail({
    preheader: `You are now the owner of ${facts.collectionName}.`,
    heading: `You now own ${facts.collectionName}`,
    lines: [
      greeting(facts.firstName),
      `${facts.previousOwnerName} transferred the collection "${facts.collectionName}" to you on Arcula. You are its owner now.`,
    ],
    cta: { label: "Open collection", url: facts.url },
    reason:
      "The previous owner stays on as a collaborator. You can remove them, or transfer the collection again, from its access settings. If you were not expecting this, contact the previous owner.",
  });
  return {
    to: facts.to,
    subject: `You now own ${truncateSubjectPart(facts.collectionName)} on Arcula`,
    text: parts.text,
    html: parts.html,
    tags: [{ name: "type", value: "transfer" }],
  };
}
