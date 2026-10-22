// The collection password's pure facts: turning a chosen password into a
// stored hash and checking one against it. No database, no session, no Hono.

import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/collectionPassword";

describe("hashPassword", () => {
  it("stores a scrypt hash with its salt and cost parameters in the string", async () => {
    const stored = await hashPassword("correct horse battery staple");
    const parts = stored.split("$");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    // The cost is readable from the stored string, not assumed by the reader.
    expect(Number(parts[1])).toBeGreaterThan(1);
    expect(Number(parts[2])).toBeGreaterThan(0);
    expect(Number(parts[3])).toBeGreaterThan(0);
    expect(parts[4]).toMatch(/^[0-9a-f]+$/);
    expect(parts[5]).toMatch(/^[0-9a-f]+$/);
  });

  it("salts every hash, so one password does not store one string", async () => {
    const first = await hashPassword("same password");
    const second = await hashPassword("same password");
    expect(first).not.toBe(second);
  });
});

describe("verifyPassword", () => {
  it("accepts the password that produced the hash", async () => {
    const stored = await hashPassword("a collection secret");
    await expect(verifyPassword("a collection secret", stored)).resolves.toBe(
      true,
    );
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("a collection secret");
    await expect(verifyPassword("a collection secreT", stored)).resolves.toBe(
      false,
    );
  });

  it("checks against the cost stored with the hash, not today's default", async () => {
    // An older, cheaper hash must keep working after the default is raised.
    const params = { N: 8192, r: 8, p: 1 };
    const stored = await hashPassword("an old password", params);
    const [prefix, N, r, p] = stored.split("$");
    expect([prefix, Number(N), Number(r), Number(p)]).toEqual([
      "scrypt",
      params.N,
      params.r,
      params.p,
    ]);
    await expect(verifyPassword("an old password", stored)).resolves.toBe(true);
  });

  it("rejects a malformed or truncated stored hash instead of throwing", async () => {
    const stored = await hashPassword("a collection secret");
    const malformed = [
      "",
      "not-a-hash",
      "scrypt$16384$8$1",
      "scrypt$notanumber$8$1$00$00",
      "scrypt$3$8$1$00$00",
      "scrypt$1$8$1$00$00",
      "scrypt$16384$8$1$zz$00",
      "scrypt$16384$8$1$abc$00",
      `${stored}$extra`,
      stored.slice(0, -2),
      stored.slice(0, 20),
    ];
    for (const candidate of malformed) {
      await expect(
        verifyPassword("a collection secret", candidate),
      ).resolves.toBe(false);
    }
  });
});
