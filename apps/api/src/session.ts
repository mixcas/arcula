// Session resolution for /api/v1/* (plan §5): the same session rides a
// cookie (web) or an Authorization: Bearer header (the future mobile
// client) — better-auth's bearer plugin makes both land in one call.

import type { Context, MiddlewareHandler } from "hono";
import { auth } from "./auth";
import { ApiError } from "./errors";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  // The four custom columns (§0.3), declared in src/auth.ts.
  firstName: string | null;
  lastName: string | null;
  tier: string;
  settings: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface SessionData {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  [key: string]: unknown;
}

// The native get-session shape: { session, user }, user at the top level
// (verified against the live handler). `null` when there is no session.
type GetSessionResult = { session: SessionData; user: SessionUser } | null;

declare module "hono" {
  interface ContextVariableMap {
    session: SessionData;
    user: SessionUser;
  }
}

export async function resolveSession(
  c: Context,
): Promise<{ session: SessionData; user: SessionUser } | null> {
  const res = (await auth.api.getSession({
    headers: c.req.raw.headers,
  })) as GetSessionResult;
  return res && res.session && res.user ? res : null;
}

/** Rejects with the `unauthorized` envelope code when no session. */
export const requireSession: MiddlewareHandler = async (c, next) => {
  const resolved = await resolveSession(c);
  if (!resolved) {
    throw new ApiError("unauthorized", "A session is required");
  }
  c.set("session", resolved.session);
  c.set("user", resolved.user);
  await next();
};
