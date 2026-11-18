// deploy-verify.ts — the end-to-end pass against a deployed Arcula.
// Usage: cd apps/api && bun scripts/deploy-verify.ts <base-url>
//
// It is the end-to-end pass, executable: health, the SPA (shell + deep
// link + cache headers, and the source-map rule: a map-emitting host — dev or
// a local checkout — serves an entry script referencing a map the host
// actually serves and parses, production's carries none), the
// agent surface's discovery documents and its 401 challenge, sign-up (and that
// its cookie is `Secure`), the session token refused as an API bearer, /me,
// the duplicate sign-up (the 422 over the gateway), create-catalogue, a
// real 12 MP photo through presign → direct PUT → process → save (the
// presigner, the bucket's CORS preflight and rule, and Sharp on the deploy
// target), a visitor read, and a reset request (the Resend call path). The
// catalogue cap is covered by the API integration suite, not here: reaching it
// would mean ten creates per run. One account is created per run under
// verify-<ts>@example.test; nothing is printed that is a credential — the
// session token, and the presigned upload URL (a bearer token), are never
// printed either. Exit code 0 = every step passed.
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { STAGED_PUT_SIGNED_HEADERS } from "@arcula/shared";
import { IMAGE_VARIANTS, variantSize } from "../src/media/variants";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base) {
  console.error("usage: bun scripts/deploy-verify.ts <base-url>");
  process.exit(2);
}

let failures = 0;
const step = (name: string, ok: boolean, detail = ""): boolean => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
  return ok;
};

const hex = () => randomUUID().replace(/-/g, "");
const ts = Date.now();
const email = `verify-${ts}@example.test`;

// Cookie jar: the session token, nothing else.
let sessionCookie: string | null = null;
const get = (path: string, authed = false) =>
  fetch(`${base}${path}`, {
    headers: authed && sessionCookie ? { cookie: sessionCookie } : {},
  });
const post = (path: string, body: unknown, authed = false) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authed && sessionCookie ? { cookie: sessionCookie } : {}),
    },
    body: JSON.stringify(body),
  });

// 1. Health. The body also says which shape this host is, so the source-map
//    rule below can be the one the host applies: dev reports its deployed
//    commit, a local API reports its checkout, and production reports
//    neither. Both map-emitting shapes are held to the map rule; production
//    is the one exception. The tool still takes only a base URL — the host
//    names the environment, not an argument and not a local variable.
let mapHost: boolean;
let hostShape: string;
{
  const res = await get("/api/health");
  const body = (await res.json()) as {
    status?: string;
    commit?: string;
    checkout?: string;
  };
  const commit = typeof body.commit === "string" ? body.commit : "";
  const checkout = typeof body.checkout === "string" ? body.checkout : "";
  mapHost = commit !== "" || checkout !== "";
  hostShape = commit
    ? `dev host (commit ${commit.slice(0, 7)})`
    : checkout
      ? `local host (checkout ${checkout})`
      : "production host (no commit or checkout)";
  step("health", res.status === 200 && body.status === "ok");
}

// 2. The SPA: shell, cache header, and a client-route deep link, plus the
//    source-map rule the host itself answers for: a map-emitting host (dev or
//    local) serves the entry script with a reference and the map it names,
//    production serves neither.
{
  const res = await get("/");
  const html = await res.text();
  step(
    "spa shell",
    res.status === 200 && html.includes("<!doctype html"),
    `cache: ${res.headers.get("cache-control")}`,
  );
  step(
    "spa shell is no-cache",
    res.headers.get("cache-control") === "no-cache",
  );
  const deep = await get("/manage");
  const deepHtml = await deep.text();
  step(
    "client route serves the shell",
    deep.status === 200 && deepHtml.includes("<!doctype html"),
  );

  // The shell names one entry module; the rule is about what that file says
  // and, on dev, what the map beside it is. The reference is read the way a
  // devtools client reads it, and nothing here throws on a miss: a step that
  // could not run is a failure with its reason, never a pass.
  const entryTag = [...html.matchAll(/<script\b[^>]*>/gi)]
    .map((match) => match[0])
    .find(
      (tag) => /\btype=["']module["']/i.test(tag) && /\bsrc=["']/i.test(tag),
    );
  const entryPath = entryTag?.match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? "";
  const entryUrl = entryPath ? new URL(entryPath, res.url) : null;
  const entry = entryUrl ? await fetch(entryUrl).catch(() => null) : null;
  const entryText = entry ? await entry.text() : "";
  const mapReference =
    entryText.match(/sourceMappingURL=([^\s'"*]+)/)?.[1] ?? "";

  if (mapHost) {
    step(
      "spa entry script references its source map",
      entry?.status === 200 && mapReference !== "",
      `${hostShape}: ${
        entryUrl
          ? `${entryUrl.pathname} → ${mapReference || "no reference"}`
          : "the shell names no entry module"
      }`,
    );
    const mapUrl =
      mapReference && entryUrl ? new URL(mapReference, entryUrl) : null;
    const mapRes = mapUrl ? await fetch(mapUrl).catch(() => null) : null;
    const mapType = mapRes?.headers.get("content-type") ?? "";
    // A missing or non-JSON answer is a failed step, not a thrown script: the
    // parse is read into a shape and the shape is asserted below.
    const map = (mapRes ? await mapRes.json().catch(() => null) : null) as {
      version?: unknown;
      sources?: unknown;
    } | null;
    const sources = Array.isArray(map?.sources) ? map.sources.length : 0;
    step(
      "the source map is served and parses",
      mapRes?.status === 200 &&
        mapType.includes("application/json") &&
        map?.version === 3 &&
        sources > 0,
      `${hostShape}: ${mapUrl?.pathname ?? "no map"} — status ${
        mapRes?.status ?? 0
      }, type ${mapType || "—"}, ${sources} source(s)`,
    );
  } else {
    step(
      "spa entry script carries no source-map reference",
      entry?.status === 200 && mapReference === "",
      `${hostShape}: ${
        mapReference
          ? `${entryUrl?.pathname ?? "the entry script"} references ${mapReference}`
          : `${entryUrl?.pathname ?? "no entry module"} is clean`
      }`,
    );
  }
}

// 2b. The agent surface's public half: the two discovery documents an MCP
//     client reads before it can connect, and the challenge that sends it
//     there. None writes and none needs a token, so the first deploy can ask
//     them; a SPA fallback would answer all three with HTML or a 404.
{
  // The audience and issuer must be *this* deployment, not merely shaped right:
  // the two-step deploy's first pass carries a localhost placeholder, and a
  // wrong AUTH_BASE_URL would otherwise ship discovery documents that point a
  // client at nothing.
  const expectedResource = `${base}/api/mcp`;
  const expectedIssuer = `${base}/api/auth`;
  const expectedMetadata = `${base}/.well-known/oauth-protected-resource/api/mcp`;

  const res = await get("/.well-known/oauth-protected-resource");
  const body = (await res.json().catch(() => ({}))) as { resource?: string };
  step(
    "MCP protected-resource metadata",
    res.status === 200 &&
      res.headers.get("content-type")?.includes("application/json") === true &&
      body.resource === expectedResource,
    body.resource,
  );

  const as = await get("/.well-known/oauth-authorization-server/api/auth");
  const asBody = (await as.json().catch(() => ({}))) as { issuer?: unknown };
  step(
    "MCP authorization-server metadata",
    as.status === 200 &&
      as.headers.get("content-type")?.includes("application/json") === true &&
      asBody.issuer === expectedIssuer,
    typeof asBody.issuer === "string" ? asBody.issuer : "",
  );

  const challenge = await post("/api/mcp", {});
  const authenticate = challenge.headers.get("www-authenticate") ?? "";
  step(
    "MCP endpoint challenges with resource_metadata",
    challenge.status === 401 &&
      authenticate.includes(`resource_metadata="${expectedMetadata}"`),
    `status ${challenge.status}`,
  );
}

// 3. Sign-up → session cookie.
{
  const res = await post("/api/auth/sign-up/email", {
    name: "Deploy Verify",
    email,
    password: "verify-pass-12345",
  });
  const cookies = res.headers.getSetCookie();
  // In a deploy the cookie is Secure and carries Better Auth's `__Secure-`
  // prefix (the stack sets NODE_ENV=production and the bundle defines it),
  // so match the attribute-prefixed name.
  sessionCookie =
    cookies.find((c) => c.startsWith("__Secure-better-auth.session_token=")) ??
    null;
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  step(
    "sign-up",
    res.status === 200 && sessionCookie !== null,
    `status ${res.status}, ${cookies.length} cookie(s)`,
  );
  // The attribute, proven at the live origin rather than assumed.
  step(
    "session cookie is Secure",
    sessionCookie !== null && /;\s*Secure\b/i.test(sessionCookie),
  );

  // 3b. The session token is not a second credential in a deployment. A deploy
  //     mounts no bearer plugin (env.ts → bearerAuthAllowed, ADR-0014), so the
  //     token the sign-up just minted is a cookie session and nothing else:
  //     presenting it as `Authorization: Bearer` must not resolve a session.
  //     This is the deployed side of the rule the pure predicate carries, and
  //     the only place it can be asked. A local stack still admits the bearer
  //     form — that is the development affordance this replaced the deploy
  //     verifier's reliance on, not a defect — but this script is aimed at a
  //     deployment, as its `__Secure-` cookie assertion above already requires.
  //     The token is never printed and never sent anywhere but this request.
  if (typeof body.token === "string") {
    const bearer = await fetch(`${base}/api/v1/me`, {
      headers: { authorization: `Bearer ${body.token}` },
    });
    step(
      "the session token is refused as an API bearer",
      bearer.status === 401,
      `status ${bearer.status}`,
    );
  } else {
    // This step is the deployed proof of the rule, so a sign-up whose body no
    // longer carries the token must fail it rather than skip it: a check that
    // did not run is never a pass (as the CORS preflight above says in its own
    // way).
    step(
      "the session token is refused as an API bearer",
      false,
      "sign-up did not return a session token, so the bearer refusal could not be checked",
    );
  }
}

// 4. The duplicate sign-up answers the native 422, over the gateway.
{
  const res = await post("/api/auth/sign-up/email", {
    name: "Deploy Verify",
    email,
    password: "verify-pass-12345",
  });
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  step(
    "duplicate sign-up is the native 422",
    res.status === 422 && body.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
    `status ${res.status}`,
  );
}

// 5. /me carries the profile.
{
  const res = await get("/api/v1/me", true);
  const body = (await res.json()) as { email?: string; tier?: string };
  step("/me", res.status === 200 && body.email === email, `tier: ${body.tier}`);
}

// 6. Create a catalogue.
let catalogueId: string | null;
{
  const res = await post("/api/v1/catalogues", { name: `Verify ${ts}` }, true);
  const body = (await res.json()) as { id?: string };
  catalogueId = body.id ?? null;
  step("create catalogue", res.status === 201 && catalogueId !== null);
}

// 7. A real 12 MP photo through presign → preflight → PUT → process → save.
//    The bytes go straight to the media bucket, so this is the one place the
//    direct hop meets the real presigner and the deployed bucket. The
//    preflight step is the CORS proof (a Node `fetch` ignores CORS, so the PUT
//    alone would prove nothing about the browser); the process number is the
//    Sharp-on-the-deploy-target measurement, and the dimensions are the ones
//    the server read back off the stored object (presign never saw a byte).
//    The presigned URL is a bearer token: it is never printed.
if (catalogueId) {
  const artworkId = hex();
  const entryId = hex();
  const W = 4000;
  const H = 3000;
  const name = "verify-12mp.jpg";
  const sample = await sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: { r: 201, g: 112, b: 39 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();

  const presign = await post(
    `/api/v1/catalogues/${catalogueId}/artworks/${artworkId}/photos/stage`,
    { entryId, contentType: "image/jpeg", size: sample.length, name },
    true,
  );
  const target = (await presign.json()) as {
    uploadUrl?: string;
    method?: string;
    headers?: Record<string, string>;
    url?: string;
  };
  step(
    "presign the 12 MP photo",
    presign.status === 200 &&
      target.method === "PUT" &&
      typeof target.uploadUrl === "string" &&
      typeof target.headers?.["content-type"] === "string",
    `${sample.length} bytes`,
  );

  // The browser's half of the hop begins with a preflight, and the in-process
  // suite can never ask for one. This asks the deployed bucket exactly what a
  // browser will — same host, same path, same origin, same requested method
  // and headers — and reads the answer. Only the presigned URL's origin and
  // path are used; its query is the bearer token and is never printed.
  if (typeof target.uploadUrl === "string") {
    const upload = new URL(target.uploadUrl);
    const preflight = await fetch(`${upload.origin}${upload.pathname}`, {
      method: "OPTIONS",
      headers: {
        origin: base,
        "access-control-request-method": "PUT",
        "access-control-request-headers": STAGED_PUT_SIGNED_HEADERS.join(","),
      },
    }).catch(() => null);
    const status = preflight?.status ?? 0;
    const allowedOrigin = preflight?.headers.get("access-control-allow-origin");
    const allowedMethods = (
      preflight?.headers.get("access-control-allow-methods") ?? ""
    )
      .toLowerCase()
      .split(/\s*,\s*/);
    const allowedHeaders = (
      preflight?.headers.get("access-control-allow-headers") ?? ""
    )
      .toLowerCase()
      .split(/\s*,\s*/);
    const missing = STAGED_PUT_SIGNED_HEADERS.filter(
      (header) => !allowedHeaders.includes(header),
    );
    const detail =
      status === 403
        ? // S3 refuses an origin its rule does not name: no CORS headers, just
          // a 403. That is the browser's PUT failing before it starts, so it is
          // reported as a check that did not run — never as a pass.
          "the check did not run: storage refused the origin (403) — the bucket's CORS rule does not name this deploy's PUBLIC_URL"
        : status === 0
          ? "the check did not run: no response from storage"
          : `status ${status}, origin ${allowedOrigin ?? "—"}${
              missing.length > 0
                ? `, missing headers: ${missing.join(", ")}`
                : ""
            }`;
    step(
      "bucket CORS preflight allows the direct PUT",
      status === 200 &&
        (allowedOrigin === base || allowedOrigin === "*") &&
        allowedMethods.includes("put") &&
        missing.length === 0,
      detail,
    );
  }

  let uploadStatus = 0;
  try {
    // `credentials: "omit"` as the browser does: the URL is the whole
    // authority for this one object, and the session cookie belongs to the
    // app's origin, not the bucket's.
    const put = await fetch(target.uploadUrl!, {
      method: "PUT",
      headers: target.headers,
      body: new Uint8Array(sample),
      credentials: "omit",
    });
    uploadStatus = put.status;
  } catch (error) {
    // The browser hop's failure mode: a CORS rule that does not admit the
    // PUT rejects the fetch itself, with no status to report. The message
    // names the origin, never the URL.
    console.log(
      `    direct PUT failed before a response: ${(error as Error).message}`,
    );
  }
  step(
    "PUT the photo straight to storage (the presigned URL)",
    uploadStatus === 200,
    `status ${uploadStatus}`,
  );

  const t0 = Date.now();
  const proc = await post(
    `/api/v1/catalogues/${catalogueId}/artworks/${artworkId}/photos/process`,
    { entryId },
    true,
  );
  const procBody = (await proc.json()) as {
    name?: string;
    width?: number | null;
    height?: number | null;
    size?: number;
    contentType?: string;
    variants?: { key: string; width: number; height: number; size: number }[];
  };
  // The original's metadata is the process answer's now: presign declared a
  // length and a type, and only the stored object can say what they are.
  step(
    "process measures the stored original (Sharp on the deploy target)",
    proc.status === 200 &&
      procBody.width === W &&
      procBody.height === H &&
      procBody.size === sample.length &&
      procBody.contentType === "image/jpeg" &&
      procBody.name === name,
    `${procBody.width}x${procBody.height}, ${procBody.size} bytes, ${procBody.name}`,
  );

  const variants = procBody.variants ?? [];
  // The expected set comes from the recipe the encoder reads, so a variant
  // added or renamed in the recipe propagates here instead of stranding the
  // pass — the table-vs-output cross-check pipeline.test.ts makes on the
  // encoder, aimed at the deployed runtime.
  const expected = IMAGE_VARIANTS.map((spec) => {
    const size = variantSize(spec, { width: W, height: H });
    return [spec.key, size.width, size.height] as const;
  });
  const got = variants.map((v) => [v.key, v.width, v.height] as const);
  step(
    "process the variants (Sharp on the deploy target)",
    proc.status === 200 && JSON.stringify(got) === JSON.stringify(expected),
    `${variants.length} variants in ${Date.now() - t0} ms`,
  );
  for (const v of variants) {
    console.log(`    ${v.key}: ${v.width}x${v.height}, ${v.size} bytes`);
  }

  const save = await post(
    `/api/v1/catalogues/${catalogueId}/artworks`,
    {
      artworkId,
      title: "Verification Study",
      artistName: "Arcula Verify",
      photos: [{ entryId, name }],
      documents: [],
    },
    true,
  );
  const saveBody = (await save.json()) as { id?: string; photos?: unknown[] };
  step(
    "save promotes the staged entry",
    // 201, not 200: this is the create (add) route — the local suite
    // asserts 201 for it, and 201 Created is the honest status for a POST
    // that creates a resource.
    save.status === 201 &&
      saveBody.id === artworkId &&
      Array.isArray(saveBody.photos) &&
      saveBody.photos.length === 1,
    `status ${save.status}`,
  );
}

// 8. A visitor (no session) reads the public catalogue and its works.
if (catalogueId) {
  const res = await get(`/api/v1/catalogues/${catalogueId}`);
  const body = (await res.json()) as { name?: string };
  step(
    "visitor reads the public catalogue",
    res.status === 200 && typeof body.name === "string",
  );
  const works = await get(`/api/v1/catalogues/${catalogueId}/artworks`);
  const page = (await works.json().catch(() => ({}))) as {
    artworks?: unknown[];
    total?: number;
  };
  step(
    "visitor reads the catalogue's works",
    // The list answers its page envelope, and the work saved above is in it.
    works.status === 200 &&
      Array.isArray(page.artworks) &&
      page.artworks.length === 1 &&
      page.total === 1,
  );
  const deep = await get(`/catalogue/${catalogueId}`);
  step(
    "the public route serves the shell",
    deep.status === 200 && (await deep.text()).includes("<!doctype html"),
  );
}

// 9. The reset request exercises the Resend call path (the mail itself
//    lands at a throwaway address; for the real mail + link, request a
//    reset for your own account on the deployed site).
{
  const res = await post("/api/auth/request-password-reset", { email });
  const body = (await res.json().catch(() => ({}))) as { status?: boolean };
  step(
    "reset request (Resend path)",
    res.status === 200 && body.status === true,
    `status ${res.status}`,
  );
}

console.log(
  failures === 0
    ? `\nVERIFY OK — ${base}`
    : `\nVERIFY FAILED — ${failures} step(s) failed — ${base}`,
);
process.exit(failures === 0 ? 0 : 1);
