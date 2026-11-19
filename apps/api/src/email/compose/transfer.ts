// The ownership-transfer notice: the mail that tells a collaborator the
// catalogue is theirs now. It is relationship mail — sent because an existing
// relationship changed, not because the account asked — and, like the
// invitation, it carries no opt-out.
//
// The catalogue name and the previous owner's name are user-controlled, so
// they are escaped in the HTML and flattened before they reach the subject.

import type { ComposedMail } from "../provider";
import { renderMail } from "./layout";
import { mailTag } from "./tag";
import { catalogueOnArcula, greeting } from "./text";

export interface TransferMailFacts {
  to: string;
  /** The new owner's stored first name, when there is one. */
  firstName?: string | null;
  catalogueName: string;
  /** How the account that handed the catalogue over is named. */
  previousOwnerName: string;
  /** The manage page on CLIENT_ORIGIN, already built by the route. */
  url: string;
}

export function ownershipTransferMail(facts: TransferMailFacts): ComposedMail {
  const parts = renderMail({
    preheader: `You are now the owner of ${facts.catalogueName}.`,
    heading: `You now own ${facts.catalogueName}`,
    lines: [
      greeting(facts.firstName),
      `${facts.previousOwnerName} transferred the catalogue “${facts.catalogueName}” to you on Arcula. You are its owner now.`,
    ],
    cta: { label: "Open catalogue", url: facts.url },
    reason:
      "The previous owner stays on as a collaborator. You can remove them, or transfer the catalogue again, from its access settings. If you were not expecting this, contact the previous owner.",
  });
  return {
    to: facts.to,
    subject: `You now own ${catalogueOnArcula(facts.catalogueName)}`,
    text: parts.text,
    html: parts.html,
    tags: [mailTag("transfer")],
  };
}
