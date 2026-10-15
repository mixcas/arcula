import { z } from "zod";

/**
 * The beta account forms: sign-up and the password reset.
 *
 * These payloads go to Better Auth's native endpoints (`/api/auth/*`), not
 * /api/v1, so they live on the web side of the contract — `packages/shared`
 * is what both sides enforce, and no one else enforces these.
 */

export interface SignUpFormValues {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export const signUpSchema = z.object({
  email: z.email("Enter a valid email address"),
  // 8 is Better Auth's own floor (its config default): failing it here
  // spares the round trip, and the API's 400 stays the backstop.
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().trim().min(1, "First name is required").max(200),
  // A last name is optional; the display name is first + last with the
  // blank half dropped.
  lastName: z.string().trim().max(200),
});

export type SignUpPayload = {
  name: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
};

export const EMPTY_SIGN_UP_FORM: SignUpFormValues = {
  email: "",
  password: "",
  firstName: "",
  lastName: "",
};

/**
 * The sign-up payload: the schema's trimmed output plus `name`, which
 * Better Auth's sign-up body requires even though the product's display
 * name is first + last. Deriving it from the same trimmed values means the
 * core `name` column and the custom first/last fields can never disagree.
 * The custom fields ride the body as additional fields — the sign-up
 * handler forwards every key it does not own to the user row, so a fresh
 * account lands with its profile half set, and the tier's DB default
 * (`free`) fills the rest.
 */
export const toSignUpPayload = (values: SignUpFormValues): SignUpPayload => {
  const parsed = signUpSchema.parse(values);
  const name = [parsed.firstName, parsed.lastName].filter(Boolean).join(" ");
  return {
    name,
    email: parsed.email,
    password: parsed.password,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
  };
};

export interface ResetPasswordFormValues {
  newPassword: string;
  confirmPassword: string;
}

export const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm the new password"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/**
 * The profile name form. A blank half is _not_ a value: the PATCH contract
 * leaves absent keys alone, so a blank is sent as absent (leave alone),
 * never as `""` — which the shared `mePatchSchema` correctly rejects on the
 * wire. That is why this schema allows blanks where the wire schema does
 * not.
 */
export interface ProfileNameFormValues {
  firstName: string;
  lastName: string;
}

export const profileNameSchema = z.object({
  firstName: z.string().trim().max(200),
  lastName: z.string().trim().max(200),
});

export interface ChangePasswordFormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm the new password"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
