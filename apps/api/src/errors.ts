// The one error envelope for /api/v1/*:
//
//   { "error": { "code", "message" } }
//
// Codes are a fixed, small set; each maps to its HTTP status. Clients
// (web today, mobile tomorrow) switch on `code`, never on `message` —
// `message` is prose for humans.
//
// /api/auth/* deliberately does NOT use this envelope: Better Auth's
// native error shape is what @better-auth/react expects.

export type ApiErrorCode =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "password-required"
  | "invalid-password"
  | "too-many-attempts"
  | "not-found"
  | "conflict"
  | "limit-reached"
  | "field-not-writable"
  | "internal";

// Hono's c.json() wants a literal status union, not `number`.
export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500;

const STATUS_BY_CODE: Record<ApiErrorCode, ApiErrorStatus> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  // A Protected collection a non-member holds no grant for. Distinct from
  // `forbidden` on purpose: it is not a refusal but a challenge, and the lock
  // screen it opens is the only thing that can pass it (ADR-0005).
  "password-required": 403,
  // An unlock attempt whose password did not match. Distinct for the same
  // reason: the prompt has to be able to say "that is not it".
  "invalid-password": 403,
  // An unlock attempt refused unread, because this address has spent the
  // window's failures on this collection. The window, never the countdown —
  // see the unlock route.
  "too-many-attempts": 429,
  "not-found": 404,
  conflict: 409,
  "limit-reached": 409,
  "field-not-writable": 409,
  internal: 500,
};

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    /** Extra structured payload (e.g. the failed fields on validation). */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }

  get status(): ApiErrorStatus {
    return STATUS_BY_CODE[this.code];
  }
}

/**
 * The single place an error becomes an envelope response. Auth-route
 * responses never reach here — Better Auth's handler already produced a
 * Response, and Hono only forwards thrown errors.
 */
export function errorResponse(err: unknown): {
  body: Record<string, unknown>;
  status: ApiErrorStatus;
} {
  if (err instanceof ApiError) {
    // details (the failed fields on validation) ride inside the same
    // `error` object, after code and message.
    return {
      body: {
        error: {
          ...(err.details ?? {}),
          code: err.code,
          message: err.message,
        },
      },
      status: err.status,
    };
  }
  // Anything else is ours to keep quiet: log the real error, return a
  // code the client can switch on, and no stack trace on the wire.
  console.error("[api] unhandled:", err);
  return {
    body: { error: { code: "internal", message: "Something went wrong" } },
    status: 500,
  };
}
