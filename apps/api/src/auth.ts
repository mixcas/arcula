// The Better Auth instance.
//
// Mounted on the Hono app at /api/auth/*. The seed script signs the owner
// up through it, and `db:reset` signs back in through the adapter.
//
// Three better-auth 1.7.x API notes: `additionalFields` takes
// type-discriminator attributes, not Zod schemas; email+password is a core
// feature configured through the `emailAndPassword` section, not a plugin;
// and `returned` (default true) already puts all four custom fields in
// session responses.

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { schema } from "@arcula/db";
import { db } from "./db";
import { corsOrigins } from "./env";
import { passwordResetMail, verificationMail } from "./email/compose";
import { clientUrl } from "./email/links";
import { emailProvider } from "./email/provider";

/** The hook's user is Better Auth's core shape; the custom columns (firstName
 *  among them) are on the row, declared above and typed for sessions in
 *  session.ts. One widening, used by both hooks. */
const firstNameOf = (user: unknown): string | null => {
  const name = (user as { firstName?: string | null }).firstName;
  return typeof name === "string" ? name : null;
};

// The four custom user columns, declared: an undeclared custom column
// fails sign-up with no useful error. The declaration and the schema's
// user table are asserted against each other in tests/adapter.test.ts.
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
  // A cookie-based state-changing request is CSRF-legitimate only from
  // an origin the API already admits — the same set as the CORS allowlist.
  trustedOrigins: corsOrigins,
  user: {
    additionalFields: userAdditionalFields,
  },
  emailAndPassword: {
    enabled: true,
    // Explicit, never the silently-baked-in default. Beta signs in
    // without a verified email; enabling verification later is this one flip.
    requireEmailVerification: false,
    // Reset is fully live in beta. Better Auth hands the hook a URL on
    // the API origin; the mail has to point at the web app, so it is
    // rewritten to CLIENT_ORIGIN before it is sent.
    sendResetPassword: async ({ user, url }) => {
      await emailProvider.send(
        passwordResetMail({
          to: user.email,
          firstName: firstNameOf(user),
          url: clientUrl(url),
        }),
      );
    },
  },
  emailVerification: {
    // The second half: the hook is wired but the auto-send stays off
    // (requireEmailVerification is false and sendOnSignUp is unset), so the
    // on-demand POST /api/auth/send-verification-email is what fires it.
    // Enabling verification later is the config flip, not a hook change.
    sendVerificationEmail: async ({ user, url }) => {
      await emailProvider.send(
        verificationMail({
          to: user.email,
          firstName: firstNameOf(user),
          url: clientUrl(url),
        }),
      );
    },
  },
  advanced: {
    // The session cookie is Secure in prod; local dev is plain
    // http, where a Secure cookie would be rejected.
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  plugins: [bearer()],
});
