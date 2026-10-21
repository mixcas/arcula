// Assertions about what a rendered mail emits, shared by the pure suites so
// the same rule is checked once and not three ways.

/** Every `href`/`src` the HTML carries, in document order. The composer's
 *  rule is that all of them are on CLIENT_ORIGIN: an off-domain link makes the
 *  mail disagree with its sender, and an off-domain image is a tracking pixel
 *  by another name. */
export function urlsIn(html: string): string[] {
  return [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
}

/** Every character in the control range, plus DEL — what a subject may never
 *  carry, because CR/LF is header injection. */
export function controlChars(value: string): string[] {
  return [...value].filter((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}
