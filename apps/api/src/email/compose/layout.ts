// The one layout every Arcula mail is rendered in, and the one place the HTML
// and the plain-text twin are built — from the same facts, so a change to the
// call to action cannot reach one part and not the other.
//
// Table-based with inline styles and a 560px card, because that is what mail
// clients render rather than what a browser would. No external stylesheet, no
// webfont, no tracking pixel: the only image is the wordmark, which is on our
// own origin. `color-scheme: light` is a request, not a guarantee — some
// clients invert, and the layout does not fight them.

import { clientLink } from "../links";
import { escapeHtml } from "./text";

// The composer's helpers are re-exported here because this is the module
// every mail builder and every test opens: one import path for "the mail
// layout and the transforms it needs".
export {
  escapeHtml,
  flattenSubject,
  normalizeSender,
  truncateSubjectPart,
} from "./text";

/** The wordmark shipped by the web app (`apps/web/public/`), 451×117 shown at
 *  160×42 on a white band. It is the only image in a mail and is not a
 *  pixel: no dimensions of 1×1, no query string, no per-recipient path. */
const WORDMARK_PATH = "/arcula-name-logo.png";
const WORDMARK_WIDTH = 160;
const WORDMARK_HEIGHT = 42;

export interface MailCta {
  /** The button's words. */
  label: string;
  /** An absolute URL on CLIENT_ORIGIN — the composer builds it, never the
   *  caller's raw string, and the layout prints it in both parts. */
  url: string;
}

export interface MailLayoutFacts {
  /** The line a client shows before opening. Not visible in the body. */
  preheader: string;
  heading: string;
  /** The body's paragraphs, in order. Greeting first, usually. */
  lines: string[];
  cta: MailCta;
  /** Why this message arrived — the footer's one line. */
  reason: string;
}

export interface RenderedMail {
  text: string;
  html: string;
}

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Both parts of a message from one set of facts. The text part is the same
 * heading, lines, call to action and reason, flattened; the HTML escapes every
 * one of them.
 */
export function renderMail(facts: MailLayoutFacts): RenderedMail {
  const logo = clientLink(WORDMARK_PATH);
  const text = [
    facts.heading,
    "",
    ...facts.lines,
    "",
    `${facts.cta.label}: ${facts.cta.url}`,
    "",
    facts.reason,
  ].join("\n");

  const paragraphs = facts.lines
    .map(
      (line) =>
        `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.5;color:#111111;">${escapeHtml(line)}</p>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(facts.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F3F0;color:#111111;font-family:${FONT_STACK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(facts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F3F0;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:#FFFFFF;border-collapse:collapse;">
<tr>
<td style="background-color:#FFFFFF;padding:24px 32px 8px 32px;">
<img src="${escapeHtml(logo)}" width="${WORDMARK_WIDTH}" height="${WORDMARK_HEIGHT}" alt="Arcula" style="display:block;width:${WORDMARK_WIDTH}px;height:${WORDMARK_HEIGHT}px;border:0;outline:none;text-decoration:none;">
</td>
</tr>
<tr>
<td style="padding:8px 32px 0 32px;">
<h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.3;font-weight:700;color:#111111;">${escapeHtml(facts.heading)}</h1>
${paragraphs}
</td>
</tr>
<tr>
<td style="padding:8px 32px 0 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td style="background-color:#000000;border-radius:4px;">
<a href="${escapeHtml(facts.cta.url)}" style="display:inline-block;padding:14px 28px;background-color:#000000;color:#FFFFFF;font-family:${FONT_STACK};font-size:16px;font-weight:600;line-height:1.2;text-decoration:none;border-radius:4px;">${escapeHtml(facts.cta.label)}</a>
</td>
</tr>
</table>
<p style="margin:16px 0 0 0;font-size:14px;line-height:1.5;color:#6B6B6B;word-break:break-all;">Or open this link: <a href="${escapeHtml(facts.cta.url)}" style="color:#111111;text-decoration:underline;">${escapeHtml(facts.cta.url)}</a></p>
</td>
</tr>
<tr>
<td style="padding:24px 32px 32px 32px;">
<hr style="height:0;border:0;border-top:1px solid #E6E4DF;margin:0 0 16px 0;">
<p style="margin:0;font-size:13px;line-height:1.5;color:#6B6B6B;">${escapeHtml(facts.reason)}</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;

  return { text, html };
}
