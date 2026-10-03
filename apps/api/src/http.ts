// Shared route plumbing (plan §7): the JSON-body parser with the
// validation envelope, and the transaction wrapper every write path
// routes through.
//
// Both used to live in routes/artworks.ts; the collection routes (S5)
// need the same two, and a helper copy-pasted between route files is two
// places for the contract to drift.

import type { Context } from "hono";
import { ZodError, type ZodType } from "zod";
import { db } from "./db";
import { ApiError } from "./errors";

/** The §7 validation envelope: the code, plus the failed fields. */
export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError("validation", "The request body is not valid JSON");
  }
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of err.issues) {
        fields[issue.path.join(".")] = issue.message;
      }
      throw new ApiError("validation", "The request body is invalid", {
        fields,
      });
    }
    throw err;
  }
}

// The transaction handle the write helpers write through.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A save's "impossible" failure: two writes raced for the same
// (artworkId, order) slot. Postgres reports it as a unique violation;
// the client can only retry, and the upserts make the retry safe.
const isUniqueViolation = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  (err as { code?: unknown }).code === "23505";

export async function safeTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(fn);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(
        "internal",
        "The save collided with a concurrent change. Try again.",
      );
    }
    throw err;
  }
}
