import { z } from "zod";
import { normalizeEmail } from "../email";
import { wireTimestamp } from "./document";

/**
 * The /api/v1 invitation contract. The offers carry no collection contents:
 * the preview names the collection, the inviter and the invited address, and
 * nothing about the works inside.
 */

export const invitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "declined",
  "revoked",
]);

export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

/**
 * POST /collections/{cid}/invitations. The address is trimmed and lowercased
 * once here, so every comparison downstream is against the stored form.
 */
export const invitationCreateSchema = z.object({
  email: z
    .string()
    .trim()
    .pipe(z.email("Enter a valid email address"))
    .transform(normalizeEmail),
});

export type InvitationCreatePayload = z.infer<typeof invitationCreateSchema>;

/** One invitation, as the owner's access view and the create response carry
 *  it. The token is absent by construction: only its hash is stored. */
export const invitationSummarySchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  email: z.string(),
  invitedByUserId: z.string(),
  status: invitationStatusSchema,
  createdAt: wireTimestamp,
  expiresAt: wireTimestamp,
  resolvedAt: wireTimestamp.nullable(),
});

export type InvitationSummary = z.infer<typeof invitationSummarySchema>;

/** POST /collections/{cid}/invitations — the row plus whether the mail went
 *  out. A provider failure is not an invitation failure. */
export const invitationCreateResponseSchema = z.object({
  invitation: invitationSummarySchema,
  emailSent: z.boolean(),
});

export type InvitationCreateResponse = z.infer<
  typeof invitationCreateResponseSchema
>;

/**
 * GET /invitations/{token} — what the invite page may show before sign-in.
 * `inviter.name` is a display name only (with a neutral fallback): the
 * inviter's own email is not part of an anonymous response.
 */
export const invitationPreviewSchema = z.object({
  collection: z.object({ id: z.string(), name: z.string() }),
  inviter: z.object({ name: z.string() }),
  email: z.string(),
  expiresAt: wireTimestamp,
});

export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

/**
 * One row of the invitee's in-app list (`GET /me/invitations`): the offer plus
 * the one name the card needs to render it. The collection's contents are not
 * reachable from a pending offer — the invitee is not a member yet — so the
 * name travels with the list rather than in a second read that would have to
 * be granted its own visibility rule.
 *
 * Never a token: the link that accepts an offer exists only in the mail
 * (ADR-0004 — only the invited inbox can accept).
 */
export const invitationInboxEntrySchema = invitationSummarySchema.extend({
  collectionName: z.string(),
});

export type InvitationInboxEntry = z.infer<typeof invitationInboxEntrySchema>;
