// prod-verify.ts — the end-to-end pass against a deployed Arcula (Phase 6
// S5). Usage: cd apps/api && bun scripts/prod-verify.ts <base-url>
//
// It is the §10.4 verification, executable: health, the SPA (shell +
// deep link + cache headers), sign-up (and that its cookie is `Secure`),
// /me, the duplicate sign-up (the 422 over the gateway), create-collection,
// the CAP (409 limit-reached on the second), a real 12 MP photo through
// stage → process → save (Sharp + S3 on the deploy target — the number
// the plan exists to measure), a visitor read, and a reset request
// (the Resend call path). One account is created per run under
// verify-<ts>@example.test; nothing is printed that is a credential.
// Exit code 0 = every step passed.
import { randomUUID } from "node:crypto";
import sharp from "sharp";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base) {
  console.error("usage: bun scripts/prod-verify.ts <base-url>");
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

// 1. Health.
{
  const res = await get("/api/health");
  const body = (await res.json()) as { status?: string };
  step("health", res.status === 200 && body.status === "ok");
}

// 2. The SPA: shell, cache header, and a client-route deep link.
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
}

// 3. Sign-up → session cookie.
{
  const res = await post("/api/auth/sign-up/email", {
    name: "Prod Verify",
    email,
    password: "verify-pass-12345",
  });
  const cookies = res.headers.getSetCookie();
  // In prod the cookie is Secure and carries Better Auth's `__Secure-`
  // prefix (the stack sets NODE_ENV=production and the bundle defines it —
  // §10.3), so match the attribute-prefixed name.
  sessionCookie =
    cookies.find((c) => c.startsWith("__Secure-better-auth.session_token=")) ??
    null;
  step(
    "sign-up",
    res.status === 200 && sessionCookie !== null,
    `status ${res.status}, ${cookies.length} cookie(s)`,
  );
  // The Phase 7 close-out, proven at the live origin rather than assumed.
  step(
    "session cookie is Secure",
    sessionCookie !== null && /;\s*Secure\b/i.test(sessionCookie),
  );
}

// 4. The duplicate sign-up answers the native 422, over the gateway.
{
  const res = await post("/api/auth/sign-up/email", {
    name: "Prod Verify",
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

// 6. Create a collection, then hit the cap.
let collectionId: string | null;
{
  const res = await post("/api/v1/collections", { name: `Verify ${ts}` }, true);
  const body = (await res.json()) as { id?: string };
  collectionId = body.id ?? null;
  step("create collection", res.status === 201 && collectionId !== null);

  const cap = await post("/api/v1/collections", { name: "Verify cap" }, true);
  const capBody = (await cap.json()) as { error?: { code?: string } };
  step(
    "cap: the second collection is 409 limit-reached",
    cap.status === 409 && capBody.error?.code === "limit-reached",
    `status ${cap.status}`,
  );
}

// 7. A real 12 MP photo through stage → process → save. The process
//    number is the Sharp-on-the-deploy-target measurement (S3's smoke
//    measured it on the stand-in; this is the real runtime).
if (collectionId) {
  const artworkId = hex();
  const entryId = hex();
  const W = 4000;
  const H = 3000;
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

  const form = new FormData();
  form.append("entryId", entryId);
  form.append(
    "file",
    new File([new Uint8Array(sample)], "verify-12mp.jpg", {
      type: "image/jpeg",
    }),
  );
  const stage = await fetch(
    `${base}/api/v1/collections/${collectionId}/artworks/${artworkId}/photos/stage`,
    { method: "POST", headers: { cookie: sessionCookie! }, body: form },
  );
  const stageBody = (await stage.json()) as {
    width?: number;
    height?: number;
    entryId?: string;
  };
  step(
    "stage 12 MP photo",
    stage.status === 200 && stageBody.width === W && stageBody.height === H,
    `${stageBody.width}x${stageBody.height}, ${sample.length} bytes`,
  );

  const t0 = Date.now();
  const proc = await post(
    `/api/v1/collections/${collectionId}/artworks/${artworkId}/photos/process`,
    { entryId },
    true,
  );
  const procBody = (await proc.json()) as {
    variants?: { key: string; width: number; height: number; size: number }[];
  };
  const variants = procBody.variants ?? [];
  step(
    "process the variants (Sharp on the deploy target)",
    proc.status === 200 && variants.length === 5,
    `${variants.length} variants in ${Date.now() - t0} ms`,
  );
  for (const v of variants) {
    console.log(`    ${v.key}: ${v.width}x${v.height}, ${v.size} bytes`);
  }

  const save = await post(
    `/api/v1/collections/${collectionId}/artworks`,
    {
      artworkId,
      title: "Verification Study",
      artistName: "Arcula Verify",
      photos: [{ entryId, name: "verify-12mp.jpg" }],
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

// 8. A visitor (no session) reads the public collection and its works.
if (collectionId) {
  const res = await get(`/api/v1/collections/${collectionId}`);
  const body = (await res.json()) as { name?: string };
  step(
    "visitor reads the public collection",
    res.status === 200 && typeof body.name === "string",
  );
  const works = await get(`/api/v1/collections/${collectionId}/artworks`);
  step("visitor reads the collection's works", works.status === 200);
  const deep = await get(`/collection/${collectionId}`);
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
