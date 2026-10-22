// The settings page's password control, as a pure decision.
//
// ADR-0005 names four states; the pending removal is a fifth, because Remove
// is applied by the same Save as every other field. The page asks two
// questions before a save: which controls to render, and what — if anything —
// to put in the PATCH as `password`. Keeping both here means the form has no
// branching of its own to get wrong, and the rules are testable without a
// DOM.

import { passwordSchema } from "@arcula/shared";

/** Which password control the page renders. `fields` is the unset state: a
 *  collection with no password gets the password + confirm pair. */
export type PasswordControlMode =
  "hidden" | "fields" | "protected" | "editing" | "removing";

export interface PasswordControlInput {
  isPublic: boolean;
  isPasswordProtected: boolean;
  /** A member asked to change the current password. */
  editing: boolean;
  /** A member asked to remove it; applied by the next save. */
  removing: boolean;
}

/** The control the current state calls for. A private collection has no
 *  password control at all: there is nothing in front of a visitor to
 *  protect. */
export const passwordControlMode = (
  input: PasswordControlInput,
): PasswordControlMode => {
  if (!input.isPublic) return "hidden";
  if (input.removing) return "removing";
  if (!input.isPasswordProtected) return "fields";
  return input.editing ? "editing" : "protected";
};

/** What one save should write for the password. `set` carries the password
 *  and nothing else: the confirmation is a client-side check and never goes
 *  on the wire. */
export type PasswordWrite =
  | { kind: "none" }
  | { kind: "set"; password: string }
  | { kind: "remove" }
  | { kind: "error"; message: string };

export interface PasswordFormInput extends PasswordControlInput {
  password: string;
  confirm: string;
}

/**
 * The password half of the PATCH, from what the form currently holds.
 *
 * `none` is the common answer: an untouched Protected collection sends no
 * password key, which is what leaves the stored hash alone. Blank fields on a
 * collection that has no password mean "still none", and blank fields while
 * editing leave the existing password in effect rather than clearing it — only
 * Remove does that.
 */
export const resolvePasswordWrite = (
  input: PasswordFormInput,
): PasswordWrite => {
  const mode = passwordControlMode(input);
  if (mode === "hidden" || mode === "protected") return { kind: "none" };
  if (mode === "removing") return { kind: "remove" };

  // `fields` or `editing`: blank means "still none", or "leave the existing
  // password alone". Only Remove clears a set password.
  if (input.password === "" && input.confirm === "") return { kind: "none" };

  const parsed = passwordSchema.safeParse(input.password);
  if (!parsed.success) {
    return {
      kind: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid password",
    };
  }
  if (input.password !== input.confirm) {
    return { kind: "error", message: "The passwords do not match" };
  }
  return { kind: "set", password: parsed.data };
};
