/**
 * The Lambda entry: the same Hono app behind an API Gateway HTTP API
 * proxy integration — one thin adapter, no container, no long-running
 * process. Local dev keeps `main.ts` (`Bun.serve`); this file is the
 * production entry and nothing else imports it, so the app code stays
 * runtime-agnostic.
 *
 * Two conversions carry the weight, and both fail silently if done
 * wrong:
 *
 * - **Set-Cookie travels in the response's `cookies` array.** The
 *   integration is payload format 2.0, whose response shape has NO
 *   `multiValueHeaders` field (that is 1.0) — API Gateway silently
 *   ignores an unknown field, so a 1.0-style response signs the user in
 *   and then loses the session cookie on the wire. The format-2.0
 *   contract: a top-level `cookies` array, each entry becoming a
 *   `set-cookie` header. The request side is the mirror image: cookies
 *   arrive in the event's `cookies` array, joined back into one header.
 * - **Binary answers are base64.** The API proxies media bytes to the
 *   client, so text and binary responses take different shapes; the
 *   split is on the content type, and text-shaped types are an allowlist
 *   (a miss falls to base64, which is always representable).
 */
import { app } from "./app";
import { CLIENT_ADDRESS_HEADER } from "./clientAddress";

interface GatewayEvent {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: {
    http?: { method?: string; path?: string; sourceIp?: string };
  };
}

const TEXT_TYPES =
  /^(text\/|application\/json|application\/javascript|application\/xml|image\/svg\+xml|application\/x-ndjson)/;

/**
 * The request headers the event becomes — the one place the adapter turns the
 * gateway's facts into the ones the app reads.
 *
 * The gateway's own `sourceIp` is the only address a client cannot choose, so
 * it is written with `set`, which replaces whatever the client sent under the
 * same name; `x-forwarded-for` is never trusted for the unlock throttle
 * (clientAddress.ts), because API Gateway appends to a client-supplied one.
 */
export function gatewayHeaders(event: GatewayEvent): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    headers.set(key, String(value));
  }
  // HTTP API delivers cookies separately from the header map.
  if (event.cookies?.length) {
    headers.set("cookie", event.cookies.join("; "));
  }
  const sourceIp = event.requestContext?.http?.sourceIp;
  if (sourceIp) headers.set(CLIENT_ADDRESS_HEADER, sourceIp);
  return headers;
}

export const handler = async (event: GatewayEvent) => {
  const method = event.requestContext?.http?.method ?? "GET";
  const url = new URL(
    `${event.rawPath}${event.rawQueryString ? `?${event.rawQueryString}` : ""}`,
    "http://localhost",
  );

  const headers = gatewayHeaders(event);

  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "HEAD" && event.body !== undefined) {
    body = event.isBase64Encoded
      ? new Uint8Array(Buffer.from(event.body, "base64"))
      : event.body;
  }

  const request = new Request(url, { method, headers, body });
  const res = await app.fetch(request);

  const contentType = res.headers.get("content-type") ?? "";
  const isText = TEXT_TYPES.test(contentType);

  let responseBody: string;
  let isBase64Encoded: boolean;
  if (isText) {
    responseBody = await res.text();
    isBase64Encoded = false;
  } else {
    responseBody = Buffer.from(await res.arrayBuffer()).toString("base64");
    isBase64Encoded = true;
  }

  const outHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return; // travels via `cookies`
    outHeaders[key] = value;
  });
  const setCookies = res.headers.getSetCookie();

  return {
    statusCode: res.status,
    headers: outHeaders,
    // Payload format 2.0: a top-level cookies array, each entry becoming
    // a set-cookie header. (multiValueHeaders is a 1.0 field, silently
    // dropped here.)
    ...(setCookies.length > 0 ? { cookies: setCookies } : {}),
    body: responseBody,
    isBase64Encoded,
  };
};
