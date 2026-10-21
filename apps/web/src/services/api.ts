/**
 * The request core of the API service layer.
 *
 * Same-origin by construction: every path here is relative (`/api/…`), and the
 * dev server proxies `/api` to the API — the page never names the API's
 * origin. That is what keeps the session cookie on the app's origin and the
 * whole surface free of CORS, and it is why the test transport only ever has
 * to emulate the proxy hop, never auth plumbing.
 *
 * One error type for every non-2xx response: the API's error envelope
 * (`{ error: { …details, code, message } }`) becomes an `ApiRequestError`,
 * and callers switch on `status` or `code`, never on `message` — `message`
 * is prose for humans. A transport failure (no server, dropped connection)
 * is NOT wrapped: it has no envelope and no status, and reporting it as an
 * HTTP error would let a caller mistake a dropped connection for "the thing
 * does not exist".
 */

/** The API's error envelope, thrown instead of returned. */
export class ApiRequestError extends Error {
  constructor(
    /** The HTTP status; absent on a transport failure, which is not thrown here. */
    public readonly status: number,
    /** The envelope's `code` — `"unknown"` when the body was not the envelope. */
    public readonly code: string,
    message: string,
    /** The failed fields on a validation error; nothing else today. */
    public readonly fields?: Record<string, string>,
    /**
     * Structured extra payload — today the invited address on a wrong-account
     * acceptance (`error.details.email`). Kept untyped here on purpose: the
     * service that cares parses it through its own schema, so a reshaped
     * detail is a loud parse failure rather than a silently absent value.
     */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** A JSON body. Omitted for reads and for the multipart stage calls. */
  body?: unknown;
  /** The multipart body of the stage routes. A FormData skips the JSON
   *  content-type — the browser sets the boundary-carrying one. */
  form?: FormData;
}

/**
 * One /api request. Resolves to the parsed JSON body; rejects with an
 * `ApiRequestError` on any non-2xx.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { method = "GET", body, form } = options;
  const init: RequestInit = { method };
  if (form !== undefined) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }

  const res = await fetch(path, init);
  if (!res.ok) {
    throw await toRequestError(res);
  }
  return (await res.json()) as T;
}

/** The envelope, or a status-prose error when the body is not one. */
async function toRequestError(res: Response): Promise<ApiRequestError> {
  let body:
    | {
        error?: {
          code?: unknown;
          message?: unknown;
          fields?: Record<string, string>;
          details?: unknown;
        };
      }
    | undefined;
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // No JSON body — a proxy error page or a connection that died mid-body.
    // The status is all there is to report.
  }
  const error = body?.error;
  return new ApiRequestError(
    res.status,
    typeof error?.code === "string" ? error.code : "unknown",
    typeof error?.message === "string"
      ? error.message
      : `Request failed with status ${res.status}`,
    error?.fields,
    isDetailRecord(error?.details) ? error.details : undefined,
  );
}

/** The envelope's `details` is an object when present; anything else is not a
 *  detail a service can parse. */
function isDetailRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
