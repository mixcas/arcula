// The collection password's pure facts: turning a chosen password into a
// stored hash and checking one against it. No database, no session, no Hono —
// the settings write hashes, the unlock route verifies, and both read the same
// encoding.
//
// The stored string carries its own cost parameters (`scrypt$N$r$p$salt$hash`)
// so the cost can be raised later and old hashes keep verifying without a
// migration. The plaintext is never stored, never logged and has no read-back
// path by design (ADR-0005).

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** The scrypt cost parameters, as encoded in every stored hash. */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/**
 * Today's cost. Raising it changes only new hashes: old strings name the cost
 * they were made with, so they keep verifying.
 */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 16384, r: 8, p: 1 };

const PREFIX = "scrypt";
const SALT_BYTES = 16;
const KEY_BYTES = 64;

const deriveKey = (
  password: string,
  salt: Buffer,
  params: ScryptParams,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_BYTES,
      { N: params.N, r: params.r, p: params.p },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });

const encodeParams = (params: ScryptParams): string =>
  [PREFIX, params.N, params.r, params.p].join("$");

/** Hash a chosen password for storage. The salt is fresh for every call. */
export const hashPassword = async (
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<string> => {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, params);
  return `${encodeParams(params)}$${salt.toString("hex")}$${key.toString("hex")}`;
};

interface StoredHash {
  params: ScryptParams;
  salt: Buffer;
  key: Buffer;
}

const decodeHex = (value: string): Buffer | null => {
  if (value.length === 0 || value.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/i.test(value)) return null;
  return Buffer.from(value, "hex");
};

const positiveInteger = (value: string): number | null => {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

/** Split a stored string, or `null` when it is not one we wrote. */
const parseStoredHash = (stored: string): StoredHash | null => {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;

  const N = positiveInteger(parts[1]);
  const r = positiveInteger(parts[2]);
  const p = positiveInteger(parts[3]);
  // scrypt requires N to be a power of two greater than one. `log2` rather
  // than a bitwise test, which would truncate above 2^31.
  if (
    N === null ||
    r === null ||
    p === null ||
    N <= 1 ||
    !Number.isInteger(Math.log2(N))
  ) {
    return null;
  }

  const salt = decodeHex(parts[4]);
  const key = decodeHex(parts[5]);
  if (salt === null || key === null) return null;

  return { params: { N, r, p }, salt, key };
};

/**
 * Whether `password` produced `stored`. A malformed, truncated or otherwise
 * unreadable string answers `false` rather than throwing — a bad row must fail
 * the check, not the request — and a wrong password fails in the same way.
 */
export const verifyPassword = async (
  password: string,
  stored: string,
): Promise<boolean> => {
  const parsed = parseStoredHash(stored);
  if (parsed === null) return false;

  try {
    const key = await deriveKey(password, parsed.salt, parsed.params);
    return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
  } catch {
    // Parameters the runtime refuses (too costly, or otherwise invalid) are a
    // failed check, not a 500.
    return false;
  }
};
