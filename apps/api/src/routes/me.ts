// /api/v1/me: the profile endpoint pair.
//
//   GET   — the session user, serialized with the custom fields.
//   PATCH — the writable set { firstName, lastName, settings }; a patch
//           touching anything else on the row is rejected with
//           `field-not-writable`.

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { user as userTable } from "@arcula/db";
import { mePatchSchema } from "@arcula/shared";
import { db } from "../db";
import { ApiError } from "../errors";
import { requireSession, type SessionUser } from "../session";

// Anything outside this set on a PATCH body is server-managed.
const WRITABLE = ["firstName", "lastName", "settings"] as const;

function serializeUser(row: typeof userTable.$inferSelect): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    emailVerified: row.emailVerified,
    firstName: row.firstName,
    lastName: row.lastName,
    tier: row.tier,
    settings: row.settings,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const meRoutes = new Hono();

meRoutes.use("/me", requireSession);

meRoutes.get("/me", async (c) => {
  const user = c.get("user");
  const [row] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.id, user.id));
  // A session whose user row is gone is a corrupt state; report it as
  // unauthorized rather than 500.
  if (!row) {
    throw new ApiError("unauthorized", "A session is required");
  }
  return c.json(serializeUser(row));
});

meRoutes.patch("/me", async (c) => {
  const user = c.get("user");

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError("validation", "Invalid JSON body");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ApiError("validation", "The body must be an object");
  }
  const rawKeys = Object.keys(raw);

  // The writable-set check runs on the raw keys, before validation:
  // touching a server-managed field is a different error from a bad value.
  const unwritable = rawKeys.filter(
    (k) => !(WRITABLE as readonly string[]).includes(k),
  );
  if (unwritable.length > 0) {
    throw new ApiError(
      "field-not-writable",
      `These fields cannot be changed here: ${unwritable.join(", ")}`,
    );
  }

  const parsed = mePatchSchema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (key && !(key in fields)) fields[key] = issue.message;
    }
    throw new ApiError("validation", "Invalid request body", {
      fields,
    });
  }

  const { firstName, lastName, settings } = parsed.data;
  const patch: Partial<
    Pick<SessionUser, "firstName" | "lastName" | "settings">
  > = {};
  if (firstName !== undefined) patch.firstName = firstName;
  if (lastName !== undefined) patch.lastName = lastName;
  if (settings !== undefined) patch.settings = settings;
  if (Object.keys(patch).length > 0) {
    await db.update(userTable).set(patch).where(eq(userTable.id, user.id));
  }

  const [row] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.id, user.id));
  return c.json(serializeUser(row));
});
