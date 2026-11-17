// Where an OAuth authorize hand-off lands after sign-in, as pure data (tier 1).
//
// The provider redirects an unauthenticated authorize to the login page with
// the whole signed authorize query as that page's querystring. If the page
// treats it as decoration, a successful sign-in goes to the dashboard and the
// client waits forever; the query has to ride through as the consent screen's
// own query. The two rules here are ours: which querystring is a hand-off, and
// what wins when a return path is also in router state.

import { describe, expect, it } from "vitest";
import { isOAuthResume, loginReturnPath } from "@/auth/oauthResume";

const SIGNED =
  "?response_type=code&client_id=https%3A%2F%2Fclient.example%2Fmetadata.json" +
  "&redirect_uri=http%3A%2F%2F127.0.0.1%3A6274%2Fcallback" +
  "&scope=openid&exp=1794943168&ba_iat=1794942568343" +
  "&ba_param=response_type&ba_param=client_id&ba_param=redirect_uri" +
  "&ba_param=scope&ba_param=exp&ba_param=ba_iat&ba_param=ba_param" +
  "&sig=crtZOrqijS2FEISo064XSIg";

describe("isOAuthResume", () => {
  it("recognises the signature's envelope", () => {
    expect(isOAuthResume(SIGNED)).toBe(true);
  });

  it("does not mistake an ordinary query for a hand-off", () => {
    expect(isOAuthResume("")).toBe(false);
    expect(isOAuthResume("?email=a%40b.test")).toBe(false);
  });
});

describe("loginReturnPath", () => {
  it("sends a sign-in back to the consent screen with the query intact", () => {
    expect(loginReturnPath(SIGNED, undefined)).toBe(`/consent${SIGNED}`);
  });

  it("keeps the guard's return path when there is no hand-off", () => {
    expect(loginReturnPath("", "/invite/token123")).toBe("/invite/token123");
  });

  it("falls back to the dashboard", () => {
    expect(loginReturnPath("", undefined)).toBe("/manage");
  });
});
