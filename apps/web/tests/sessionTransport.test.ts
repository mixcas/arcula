// @vitest-environment jsdom
//
// The G8 seam: the component suites will render against the real API
// through the cookie-jar transport, so the transport itself gets one
// focused test instead of a hundred accidental ones. It proves, end to
// end against the local stack, that
//
//   sign-in (Better Auth react client) -> session cookie captured ->
//   get-session round-trips -> the same cookie authenticates /api/v1/me ->
//   sign-out clears the cookie (Max-Age=0) -> /api/v1/me is anonymous.
//
// jsdom, not node: the react client resolves its base from
// `window.location.origin`, which in the node environment would leave it
// without an absolute URL (better-fetch rejects relative bases). jsdom's
// default page URL is http://localhost:3000 — the dev origin the transport
// emulates.
//
// The account is run-scoped: the test database persists across runs, and
// email is unique.
import { expect, it, describe } from "vitest";
import { authClient } from "@/auth/client";

describe("the session transport against the real stack", () => {
  const email = `transport-${Math.random().toString(36).slice(2, 10)}@arcula.test`;
  const password = "transport-pass-123";

  it("round-trips a session: sign-in, get-session, /api/v1/me, sign-out", async () => {
    await authClient.signUp.email({ name: "Transport", email, password });
    await authClient.signIn.email({ email, password });

    // The session the react client just created round-trips over the wire
    // with the captured cookie — the same GET /api/auth/get-session the
    // client's useSession() performs on mount. The wire shape is
    // { session, user }: the user is a top-level sibling, not nested.
    const sessionRes = await fetch("/api/auth/get-session");
    expect(sessionRes.status).toBe(200);
    const session = (await sessionRes.json()) as {
      user?: { id?: string; email?: string } | null;
      session?: { userId?: string } | null;
    };
    expect(session.user?.email).toBe(email);
    expect(typeof session.user?.id).toBe("string");
    expect(session.session?.userId).toBe(session.user?.id);

    // The load-bearing property: the same cookie that authenticated the
    // Better Auth route authenticates the v1 API — the session is one
    // artifact, not two.
    const me = await fetch("/api/v1/me");
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { email?: string };
    expect(meBody.email).toBe(email);

    // Sign-out sets the cookie with Max-Age=0; the jar must honour the
    // deletion, or every later test in this file inherits this session.
    await authClient.signOut();
    const after = await fetch("/api/v1/me");
    expect(after.status).toBe(401);
  }, 30000);

  it("carries a failed sign-in's status + code, which LoginPage maps", async () => {
    // The react client does not reject on auth failure: better-fetch
    // (without `throw: true`) resolves to { data: null, error }, where
    // error is the response body plus status. This is the value
    // AuthProvider rethrows and LoginPage maps.
    const result = (await authClient.signIn.email({
      email,
      password: "definitely-wrong",
    })) as {
      data: unknown;
      error: { message?: string; code?: string; status?: number } | null;
    };
    expect(result.data).toBeNull();
    expect(result.error?.status).toBe(401);
    expect(result.error?.code).toBe("INVALID_EMAIL_OR_PASSWORD");
  }, 30000);
});
