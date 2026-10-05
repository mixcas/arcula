import { z } from "zod";

/**
 * The /api/v1/me wire contract (Phase 5, plan §5/§7).
 *
 * The profile surface is the only place the user's custom columns
 * (firstName, lastName, tier, settings) reach the client: Better Auth's
 * session carries the core fields only, so /me is where the UI learns the
 * tier it reads COLLECTION_LIMITS on, and the names the menu and the profile
 * page render.
 *
 * createdAt/updatedAt are ISO strings — the /me serializer's own convention
 * (`toISOString()`), distinct from the collections/artworks
 * `{ seconds, nanoseconds }` wire shape elsewhere in the API.
 */
export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  emailVerified: z.boolean(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  tier: z.string(),
  settings: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SessionUserRead = z.infer<typeof sessionUserSchema>;

/**
 * PATCH /api/v1/me. The API's writable set — anything else on the row is
 * server-managed, and a body that touches one is rejected with
 * `field-not-writable` before these constraints ever run (the typed-column
 * equivalent of the old rules `hasOnly(…)` clause, §5).
 */
export const mePatchSchema = z.object({
  firstName: z.string().min(1).max(200).optional(),
  lastName: z.string().min(1).max(200).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export type MePatchPayload = z.infer<typeof mePatchSchema>;
