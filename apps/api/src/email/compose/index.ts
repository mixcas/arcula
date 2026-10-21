// The mail composer: one module every transactional message is built through.
// A builder takes plain facts and returns the complete message (recipient,
// subject, text, HTML, and the `type` tag), so identity, layout, escaping and
// the call-to-action rule have one definition instead of one per call site.
//
// Account mail lives in `account.ts`; the relationship mail (invitations and
// ownership transfers) in `invitation.ts` and `transfer.ts`. Everything they
// share — the layout, the escaping and the header-safe subject helpers — is
// exported here.

export { renderMail } from "./layout";
export type { MailCta, MailLayoutFacts, RenderedMail } from "./layout";
export { passwordResetMail, verificationMail } from "./account";
export type { AccountMailFacts } from "./account";
export { invitationMail } from "./invitation";
export type { InvitationMailFacts } from "./invitation";
export { ownershipTransferMail } from "./transfer";
export type { TransferMailFacts } from "./transfer";
