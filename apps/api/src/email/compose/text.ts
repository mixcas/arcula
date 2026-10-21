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
      // C0, DEL and C1: everything a header may not carry. U+2028/U+2029 are
      // line separators rather than controls, and the whitespace collapse
      // below turns them into spaces like any other break.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * A flattened name cut to `max` characters, ellipsis included. Counted in code
 * points, not UTF-16 units: an emoji is one character to a reader, and slicing
 * units could cut a surrogate pair in half and emit an invalid subject.
 */
export function truncateSubjectPart(value: string): string {
  const flat = flattenSubject(value);
  const characters = [...flat];
  if (characters.length <= SUBJECT_NAME_MAX) return flat;
  return `${characters
    .slice(0, SUBJECT_NAME_MAX - 1)
    .join("")
    .trimEnd()}…`;
}

/** The tail both relationship mails name the collection with: the shortened
 *  title and the product, as a subject carries them. */
export function collectionOnArcula(collectionName: string): string {
  return `${truncateSubjectPart(collectionName)} on Arcula`;
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

/**
 * `EMAIL_REPLY_TO` as the header value it would become, or `null` when the
 * variable is unset. The provider sends this value and the invitation copy
 * only offers a reply when one reaches a person, so both read the one rule:
 * the footer cannot promise a header the transport omits.
 */
export function configuredReplyTo(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? normalizeSender(trimmed) : null;
}

/** The opening line: the account's first name when one is stored, else a
 *  neutral `Hi,`. The name is flattened here and escaped by the renderer. */
export function greeting(firstName?: string | null): string {
  const name = firstName ? flattenSubject(firstName) : "";
  return name ? `Hi ${name},` : "Hi,";
}
