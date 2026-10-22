// The settings page's password decision, as a pure fold: which control the
// four states call for, and what the save writes. No DOM, no Mantine — these
// are the two rules a screenshot cannot prove.

import { describe, expect, it } from "vitest";
import {
  passwordControlMode,
  resolvePasswordWrite,
  type PasswordControlInput,
  type PasswordFormInput,
} from "@/components/manage/collectionPassword";

const control = (
  overrides: Partial<PasswordControlInput> = {},
): PasswordControlInput => ({
  isPublic: true,
  isPasswordProtected: false,
  editing: false,
  removing: false,
  ...overrides,
});

const form = (
  overrides: Partial<PasswordFormInput> = {},
): PasswordFormInput => ({
  ...control(),
  password: "",
  confirm: "",
  ...overrides,
});

describe("passwordControlMode", () => {
  it("shows nothing at all on a private collection", () => {
    expect(passwordControlMode(control({ isPublic: false }))).toBe("hidden");
    expect(
      passwordControlMode(
        control({ isPublic: false, isPasswordProtected: true, editing: true }),
      ),
    ).toBe("hidden");
  });

  it("offers the fields when a public collection has no password", () => {
    expect(passwordControlMode(control())).toBe("fields");
  });

  it("states that a set password stays in effect until Reset or Remove", () => {
    expect(passwordControlMode(control({ isPasswordProtected: true }))).toBe(
      "protected",
    );
  });

  it("shows the fields with Cancel while changing a set password", () => {
    expect(
      passwordControlMode(
        control({ isPasswordProtected: true, editing: true }),
      ),
    ).toBe("editing");
  });

  it("shows the pending removal while a Remove is waiting for Save", () => {
    expect(
      passwordControlMode(
        control({ isPasswordProtected: true, removing: true }),
      ),
    ).toBe("removing");
    expect(
      passwordControlMode(
        control({ isPasswordProtected: false, removing: true }),
      ),
    ).toBe("removing");
  });
});

describe("resolvePasswordWrite", () => {
  it("sends nothing when a Protected collection is untouched", () => {
    expect(
      resolvePasswordWrite(
        form({
          isPasswordProtected: true,
          // Stale text left in the hidden buffers must not be written either.
          password: "typed-then-cancelled",
          confirm: "typed-then-cancelled",
        }),
      ),
    ).toEqual({ kind: "none" });
  });

  it("sends nothing when a public collection has no password and the fields are blank", () => {
    expect(resolvePasswordWrite(form())).toEqual({ kind: "none" });
  });

  it("sets the password and never includes the confirmation", () => {
    expect(
      resolvePasswordWrite(
        form({ password: "long-enough", confirm: "long-enough" }),
      ),
    ).toEqual({ kind: "set", password: "long-enough" });
  });

  it("sets the password while changing an existing one", () => {
    expect(
      resolvePasswordWrite(
        form({
          isPasswordProtected: true,
          editing: true,
          password: "new-password",
          confirm: "new-password",
        }),
      ),
    ).toEqual({ kind: "set", password: "new-password" });
  });

  it("leaves the existing password alone when the editing fields are blank", () => {
    expect(
      resolvePasswordWrite(form({ isPasswordProtected: true, editing: true })),
    ).toEqual({ kind: "none" });
  });

  it("rejects a confirmation that does not match", () => {
    expect(
      resolvePasswordWrite(
        form({ password: "long-enough", confirm: "long-enough-but-different" }),
      ),
    ).toEqual({ kind: "error", message: "The passwords do not match" });
  });

  it("rejects a password below the shared minimum", () => {
    const write = resolvePasswordWrite(
      form({ password: "short", confirm: "short" }),
    );
    expect(write.kind).toBe("error");
    if (write.kind === "error") {
      expect(write.message).toBe("Password must be at least 8 characters");
    }
  });

  it("removes the password only when Remove was chosen", () => {
    expect(
      resolvePasswordWrite(form({ isPasswordProtected: true, removing: true })),
    ).toEqual({ kind: "remove" });
  });

  it("sends nothing on a private collection, even with a typed password", () => {
    expect(
      resolvePasswordWrite(
        form({
          isPublic: false,
          password: "long-enough",
          confirm: "long-enough",
        }),
      ),
    ).toEqual({ kind: "none" });
  });
});
