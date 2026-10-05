/**
 * The /api/v1/me pair (Phase 5, plan §7).
 *
 * The session the Better Auth client holds carries the core fields only;
 * the custom columns — tier, first/last name, settings — ride /me. The
 * responses are parsed through `sessionUserSchema` (the wire contract, plan
 * §7), the same doctrine as `collectionReadSchema`: a server reshape is a
 * parse error at the boundary, not a render of a half-shaped user.
 */

import {
  sessionUserSchema,
  type MePatchPayload,
  type SessionUserRead,
} from "@arcula/shared";
import { apiRequest } from "./api";

const BASE = "/api/v1/me";

export const meService = {
  /** The session user including the custom columns. */
  async getMe(): Promise<SessionUserRead> {
    return sessionUserSchema.parse(await apiRequest<unknown>(BASE));
  },

  /**
   * The profile save. The answer is the updated row, so the caller needs no
   * second read. Absent keys are left alone by the route; these fields have
   * no "clear to blank" sentinel (a blank name is not a value).
   */
  async updateProfile(payload: MePatchPayload): Promise<SessionUserRead> {
    return sessionUserSchema.parse(
      await apiRequest<unknown>(BASE, { method: "PATCH", body: payload }),
    );
  },
};
