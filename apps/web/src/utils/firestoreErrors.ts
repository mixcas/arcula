import { FirebaseError } from "firebase/app";

/**
 * True when the error is Firestore's `permission-denied` — the rules denying
 * the operation on purpose rather than something failing. Used to tell "the
 * data is off-limits to you" apart from "something broke", so pages can
 * render their expected state (e.g. a private collection) instead of an
 * error.
 */
export const isPermissionDenied = (error: unknown): boolean =>
  error instanceof FirebaseError && error.code === "permission-denied";
