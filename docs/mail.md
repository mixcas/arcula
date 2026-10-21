# Mail

Arcula sends four mails — password reset, address verification, an invitation
and an ownership-transfer notice — composed by one module with one identity:
`Arcula <noreply@arcula.art>` as the sender, `Arcula <hello@arcula.art>` as
Reply-To when `EMAIL_REPLY_TO` is set, the hosted wordmark, one call-to-action
and the same URL in the text part, a line saying why the message arrived, and
no tracking pixel. The configuration is in the root
[README](../README.md#mail); the reasoning behind the identity and the message
shape is in [#75](https://github.com/mixcas/arcula/issues/75).

The wordmark is `apps/web/public/arcula-name-logo.png` — the one the SPA
serves, not a second copy. Vite serves it in dev and the Lambda that serves the
SPA serves it in production; it is the only image a mail carries.

Dev sets `EMAIL_REPLY_TO` empty on purpose: dev has no monitored inbox, and the
code never invents an address. Production sets `Arcula <hello@arcula.art>`.
The invitation footer follows the configuration: it offers a reply only when a
Reply-To is configured, and otherwise tells the recipient they can ignore the
mail — it never promises a person on the other end of an address that is not
monitored.

This page records the two things that are deliberately **not** built. Both come
from #75, and both are deferred because a code change cannot safely make them
true.

## DMARC: reporting, then enforcement

`_dmarc.arcula.art` is currently `v=DMARC1; p=none;` with no reporting, so
there is no evidence of what fails and nothing stops forgery. The staged
record:

1. `v=DMARC1; p=none; rua=mailto:<analyzer address>;` — for 2–4 weeks, while
   the reports show what is sending as the domain.
2. `v=DMARC1; p=quarantine; rua=mailto:<analyzer address>;`
3. `v=DMARC1; p=reject; rua=mailto:<analyzer address>;`

A free analyzer (Postmark DMARC, dmarcian) is the least-effort `rua`
destination. Dev gets its own `_dmarc.dev.arcula.art` at `p=none`, so
production's eventual enforcement never catches dev. Do not add `ruf` and do
not rely on `pct`: both are poorly supported. This is a DNS change on reports,
not a release — never bundle it with a deploy.

## Opt-out: only if complaints appear

These four mails are two account mails and two relationship notices, and
Resend's guidance treats this kind of mail as exempt, so no opt-out ships today
and no mail promises one. Revisit if Resend's deliverability insights show
complaints. The shape when it is built:

- a local `email_opt_outs` table keyed by the normalised address;
- an HMAC token over the address;
- `GET` shows a confirmation page, `POST` records the opt-out and answers 200 —
  RFC 8058 one-click;
- `List-Unsubscribe` and `List-Unsubscribe-Post` on invitation mail only;
- invitation create and resend refuse a suppressed address with a clear
  conflict;
- account mail and the transfer notice are never suppressed — only the
  invitation is, and it is the only one that would carry the header — so an
  account can always recover;
- the migration ships in its own release, before the code that reads it.
