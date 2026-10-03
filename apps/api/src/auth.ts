// The Better Auth instance (plan §5).
//
// Declared here, mounted on the Hono app at /api/auth/* in Phase 2. Phase 1
// proves the instance itself: the seed script signs the owner up through it,
// and `db:reset` signs back in through the adapter — the Phase 1 exit
// criterion.
//
// Three better-auth 1.7.x API notes against the plan's §5 wording (recorded
// in §15): `additionalFields` takes type-discriminator attributes, not Zod
// schemas; email+password is a core feature configured through the
// `emailAndPassword` section, not a plugin; and the old `includeFields`
// option is gone — `returned` (default true) already puts all four custom
// fields in session responses.

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { schema } from "@arcula/db";
import { db } from "./db";

// The four custom user columns, declared (the opaque-sign-up gotcha, §5):
// an undeclared custom column fails sign-up with no useful error. The
// declaration and the schema's user table are asserted against each other in
// tests/adapter.test.ts.
export const userAdditionalFields = {
  firstName: { type: "string", required: false },
  lastName: { type: "string", required: false },
  tier: { type: "string", required: true, defaultValue: "free" },
  settings: { type: "json", required: false },
} as const;

export const auth = betterAuth({
  secret: process.env.AUTH_SECRET,
  baseURL: process.env.AUTH_BASE_URL,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  user: {
    additionalFields: userAdditionalFields,
  },
  emailAndPassword: {
    enabled: true,
    // G6: explicit, never the silently-baked-in default. Beta signs in
    // without a verified email; enabling verification later is this one flip.
    requireEmailVerification: false,
  },
  plugins: [bearer()],
});
