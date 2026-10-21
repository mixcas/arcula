/**
 * Who is looking at an invitation, and what the page may offer them.
 *
 * The address comparison is the shared contract's own rule — trimmed and
 * lowercased — so the page and the accept route cannot disagree about whether
 * this account is the invited one. That matters in both directions: showing
 * "accept" to the wrong account is a refusal the user cannot fix, and treating
 * the right account as a mismatch hides the one action the mail exists for.
 */

import { normalizeEmail } from "@arcula/shared";

export type InvitationAudience = "signed-out" | "matching" | "mismatched";

/** The one field the decision needs; `currentUser` satisfies it. */
export interface InvitationViewer {
  email: string | null;
}

export function invitationAudience(
  invitedEmail: string,
  viewer: InvitationViewer | null,
): InvitationAudience {
  if (!viewer) return "signed-out";
  const invited = normalizeEmail(invitedEmail);
  // An empty invited address is a malformed preview, never a match: without
  // the guard a viewer with no email would compare equal to nothing.
  return invited !== "" && invited === normalizeEmail(viewer.email ?? "")
    ? "matching"
    : "mismatched";
}
