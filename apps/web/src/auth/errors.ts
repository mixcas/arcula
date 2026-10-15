/**
 * The failed Better Auth client call, and the lift onto a real Error that
 * the auth forms switch on.
 *
 * better-fetch (without `throw: true`, which the client does not set) does
 * not reject a failed call: it resolves to `{ data: null, error }`, where
 * `error` is the response body spread with `status`/`statusText` —
 * `{ message, code, status, statusText }` on a 4xx. Lifting it onto a real
 * `Error` (lint's only-throw-error wants one) carrying `status` and `code`
 * is what lets a form switch on the native code — `INVALID_EMAIL`,
 * `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, … — the way the service layer
 * does on an `ApiRequestError`, never on the prose message.
 */
export function toAuthError(
  result:
    | {
        error?: {
          message?: string;
          code?: string;
          status?: number;
        } | null;
      }
    | null
    | undefined,
  fallback: string,
): Error | null {
  const error = result?.error;
  if (!error) return null;
  const failed = new Error(error.message ?? fallback);
  Object.assign(failed, { status: error.status, code: error.code });
  return failed;
}
