import { z } from "zod";
import type { CollectionRole } from "../types";
import { invitationSummarySchema } from "./invitation";

/**
 * The access view: who may read and change a collection.
 *
 * `GET /collections/{cid}/access` is the one source of the caller's role for
 * the settings and the access card — the dashboard list carries a `role` too,
 * but a list row is not where an administrative screen may read one from.
 *
 * A collaborator reads the members and nothing else: the invitation list is
 * the owner's administrative view (addresses, expiry, the token lifecycle), so
 * `invitations` is absent from a collaborator's document — not empty.
 */

/** The role enum, pinned to the client's `CollectionRole` at compile time. */
export const collectionRoleSchema = z.enum([
  "owner",
  "collaborator",
]) satisfies z.ZodType<CollectionRole>;

/** One account with access. `name` is the display name, falling back to the
 *  email address, exactly as the dashboard names an owner. */
export const collectionMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
});

export type CollectionMember = z.infer<typeof collectionMemberSchema>;

export const collectionAccessSchema = z.object({
  /** What the caller is to this collection. */
  role: collectionRoleSchema,
  owner: collectionMemberSchema,
  /** Everyone else with access, in the order they were added. The owner is
   *  never one of them — `collections.userId` is the one owner fact. */
  collaborators: z.array(collectionMemberSchema),
  /** Owner only: every pending invitation, expired ones included (their
   *  status stays `pending` — expiry is computed from `expiresAt`). Absent
   *  for a collaborator. */
  invitations: z.array(invitationSummarySchema).optional(),
});

export type CollectionAccess = z.infer<typeof collectionAccessSchema>;

/**
 * The transfer payload: the collaborator who becomes the collection's owner.
 *
 * The recipient must already have access (ADR-0004), so the target is an
 * account id — never an email. A transfer to an arbitrary address would create
 * a collaborator and an owner in one step, bypassing the invitation's consent.
 */
export const collectionTransferSchema = z.object({
  userId: z.string().min(1, "Choose a collaborator"),
});

export type CollectionTransferPayload = z.infer<
  typeof collectionTransferSchema
>;

/**
 * The transfer's answer. The transfer is committed before the notice is
 * attempted, so the only thing `emailSent` tells the caller is whether a
 * resend — or telling the new owner another way — is needed.
 */
export const collectionTransferResponseSchema = z.object({
  transferred: z.literal(true),
  emailSent: z.boolean(),
});

export type CollectionTransferResponse = z.infer<
  typeof collectionTransferResponseSchema
>;
