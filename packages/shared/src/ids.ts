/**
 * The one id mint, shared by the API and the browser.
 *
 * Collection, artwork, invitation and media-namespace ids are all minted here,
 * so the two halves of the product cannot drift on the shape — which is the
 * drift this module exists to remove. The shape is a route segment and an
 * object-key segment, which fixes two of its properties:
 *
 * - **No hyphen.** Routes carry the id in a `{urlizedName}-{id}` segment and
 *   `parseId` recovers it by cutting at the LAST hyphen, so a hyphen inside an
 *   id would put that cut inside the id itself.
 * - **No case folding on read.** Ids are copied out of links the product wrote,
 *   never retyped; a case-flipped link is a clean not-found rather than a
 *   lookup against a different id.
 *
 * Ids minted before this module existed keep their 32-character hex shape.
 * They are primary keys and object-key segments, so they are never rewritten;
 * both lengths coexist permanently.
 */

/**
 * The minted id's length. A product choice, stated once: ten base62 characters
 * are about 59.5 bits, far more than a password-gated link needs, while the
 * id stays a small fraction of an address.
 */
export const ID_LENGTH = 10;

/**
 * Base62, in the order a reader expects to see stated: digits, then uppercase,
 * then lowercase. Every character is URL-safe and hyphen-free, which is what
 * lets the route parser cut at the last hyphen without landing inside an id.
 */
export const ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * The shape the mint emits: exactly `ID_LENGTH` characters of `ID_ALPHABET`.
 *
 * Deliberately narrower than the `MINTED_ID_RE` validator, which must keep
 * accepting the ids minted before this change.
 */
export const MINTED_ID_SHAPE_RE = /^[0-9A-Za-z]{10}$/;

/** The one method of the platform's secure source this module needs. */
interface SecureRandomSource {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

// The platform source, narrowed once. The shared package binds no runtime
// types — it runs in Bun, Node and the browser — so this structural type is
// the whole contract, and the object (not a bound method) is captured so the
// mint always calls the source the platform actually exposes.
//
// `globalThis` is real at runtime in all three runtimes but carries no
// `crypto` type under this package's lib; the cast is that gap, once.
const platform = globalThis as typeof globalThis & {
  crypto?: SecureRandomSource;
};
const secureSource = platform.crypto;

/**
 * The largest multiple of the alphabet's size that fits in one byte.
 *
 * Bytes at or above it are redrawn rather than reduced modulo the alphabet:
 * `256 % 62` is 8, so 249–255 would map onto the first eight symbols twice as
 * often as the rest, and an id would carry less entropy than it advertises.
 */
const REJECTION_THRESHOLD = 256 - (256 % ID_ALPHABET.length);

/** A fresh row id: ten base62 characters, never a hyphen. */
export const mintId = (): string => {
  if (!secureSource) {
    throw new Error(
      "mintId needs a cryptographically secure random source (crypto.getRandomValues)",
    );
  }
  const bytes = new Uint8Array(ID_LENGTH);
  let id = "";
  while (id.length < ID_LENGTH) {
    secureSource.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= REJECTION_THRESHOLD) continue;
      id += ID_ALPHABET[byte % ID_ALPHABET.length];
      if (id.length === ID_LENGTH) break;
    }
  }
  return id;
};
