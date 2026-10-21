// The text-level facts every mail shares: the display name a sender carries,
// how a user-controlled value becomes HTML, and how one becomes a header-safe
// subject.
//
// Deliberately dependency-free. The provider imports this file to normalise
// EMAIL_FROM / EMAIL_REPLY_TO, and the layout imports it to escape a value,
// without either importing the other.

/** The display name every Arcula mail is sent under. A configured sender
 *  without one would look like an anonymous relay, which is exactly the shape
 *  a recipient is right to distrust. */
export const SENDER_NAME = "Arcula";

/** The most of a collection or inviter name a subject carries. The body
 *  always has the whole value. */
export const SUBJECT_NAME_MAX = 40;

/**
 * The five characters that turn user text into markup. `'` is escaped too:
 * every attribute in the layout is double-quoted today, but a value reaching
 * a single-quoted attribute tomorrow must not be the thing that notices.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * One line of user text, safe to place in a header. CR, LF and the rest of
 * the control range become spaces — a newline in a subject is header
 * injection — and runs of whitespace collapse so a name written across lines
 * does not arrive with the gaps in it.
 */
export function flattenSubject(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** A flattened name cut to `max` characters, ellipsis included. */ export function truncateSubjectPart(
  value: string,
  max = SUBJECT_NAME_MAX,
): string {
  const flat = flattenSubject(value);
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** A user name reduced to something one line of text can carry. */
export function oneLine(value: string): string {
  return flattenSubject(value);
}

/**
 * `EMAIL_FROM` / `EMAIL_REPLY_TO` as a header value. A bare address gets the
 * product's display name; an address that already has one is kept as written.
 * An empty value is a configuration error rather than an anonymous sender.
 */
export function normalizeSender(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("a mail sender cannot be empty");
  // `<` is the display-name form's tell; the name itself is the operator's.
  if (trimmed.includes("<")) return trimmed;
  return `${SENDER_NAME} <${trimmed}>`;
}

/** The opening line: the account's first name when one is stored, else a
 *  neutral `Hi,`. The name is flattened here and escaped by the renderer. */
export function greeting(firstName?: string | null): string {
  const name = firstName ? oneLine(firstName) : "";
  return name ? `Hi ${name},` : "Hi,";
}
