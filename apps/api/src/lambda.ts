/**
 * The Lambda entry (Phase 6, plan §10.2): the same Hono app behind an
 * API Gateway HTTP API proxy integration — one thin adapter, no
 * container, no long-running process. Local dev keeps `main.ts`
 * (`Bun.serve`); this file is the production entry and nothing else
 * imports it, so the app code stays runtime-agnostic.
 *
 * Two conversions carry the weight, and both fail silently if done
 * wrong:
 *
 * - **Set-Cookie must travel via `multiValueHeaders`.** The standard
 *   `Headers` view collapses multiple Set-Cookie values into one
 *   comma-joined string, and a session cookie mangled that way breaks
 *   sign-in in a way no screenshot shows. The `cookies` array in the
 *   event is joined back into one `cookie` header for the request.
 * - **Binary answers are base64.** The API proxies media bytes to the
 *   client, so text and binary responses take different shapes; the
 *   split is on the content type, and text-shaped types are an allowlist
 *   (a miss falls to base64, which is always representable).
 */
import { app } from "./app";

interface GatewayEvent {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string; path?: string } };
}

const TEXT_TYPES =
  /^(text\/|application\/json|application\/javascript|application\/xml|image\/svg\+xml|application\/x-ndjson)/;

export const handler = async (event: GatewayEvent) => {
  const method = event.requestContext?.http?.method ?? "GET";
  const url = new URL(
    `${event.rawPath}${event.rawQueryString ? `?${event.rawQueryString}` : ""}`,
    "http://localhost",
  );

  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    headers.set(key, String(value));
  }
  // HTTP API delivers cookies separately from the header map.
  if (event.cookies?.length) {
    headers.set("cookie", event.cookies.join("; "));
  }

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
  const multiValueHeaders: Record<string, string[]> = {};
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return; // split out below
    outHeaders[key] = value;
  });
  const setCookies = res.headers.getSetCookie();
  if (setCookies.length > 0) {
    multiValueHeaders["set-cookie"] = setCookies;
  }

  return {
    statusCode: res.status,
    headers: outHeaders,
    multiValueHeaders,
    body: responseBody,
    isBase64Encoded,
  };
};
