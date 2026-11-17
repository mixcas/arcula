// The signed consent query, at its seam: which parameters survive the filter,
// and which client links may be rendered.
//
// The plugin signs a query by naming each parameter it covers in `ba_param`
// and appending `sig`; the consent screen must post back exactly that subset.
// A browser is free to append anything to the URL it was redirected to, so the
// filter is what keeps an unsigned extra out of the signed blob — and what
// makes the provider see the same query it signed.

import { describe, expect, it } from "vitest";
import {
  httpsOnlyLink,
  isSignedConsentQuery,
  signedConsentQuery,
} from "../src/consentQuery";

const REDIRECT =
  "?response_type=code" +
  "&client_id=https%3A%2F%2Fclient.example%2Fmetadata.json" +
  "&redirect_uri=http%3A%2F%2F127.0.0.1%3A6274%2Fcallback" +
  "&scope=openid+profile+offline_access" +
  "&state=xyz" +
  "&exp=1794943168" +
  "&ba_iat=1794942568343";

const SIGNED =
  REDIRECT +
  "&ba_param=response_type" +
  "&ba_param=client_id" +
  "&ba_param=redirect_uri" +
  "&ba_param=scope" +
  "&ba_param=state" +
  "&ba_param=exp" +
  "&ba_param=ba_iat" +
  "&ba_param=ba_param" +
  "&sig=crtZOrqijS2FEISo064XSIg";

describe("signedConsentQuery", () => {
  it("keeps the signed parameters and the signature's own envelope", () => {
    const params = new URLSearchParams(SIGNED);
    const query = new URLSearchParams(signedConsentQuery(params));
    expect(query.get("client_id")).toBe("https://client.example/metadata.json");
    expect(query.get("sig")).toBe("crtZOrqijS2FEISo064XSIg");
    // Every name the signature covers is still there; repeats are preserved.
    expect(query.getAll("ba_param")).toEqual([
      "response_type",
      "client_id",
      "redirect_uri",
      "scope",
      "state",
      "exp",
      "ba_iat",
      "ba_param",
    ]);
  });

  it("drops a parameter the signature does not cover", () => {
    // A browser (or an extension) can append anything to the redirect's URL.
    // Posting it would make the signed blob differ from the one signed.
    const params = new URLSearchParams(
      `${SIGNED}&utm_source=newsletter&evil=1`,
    );
    const query = new URLSearchParams(signedConsentQuery(params));
    expect(query.get("utm_source")).toBeNull();
    expect(query.get("evil")).toBeNull();
  });

  it("answers a symlink of the signature envelope unchanged", () => {
    // `sig` and `ba_param` are always in scope, even if a redirect somehow
    // left them out of its own `ba_param` list.
    const query = signedConsentQuery(
      new URLSearchParams("sig=abc&client_id=c&ba_param=client_id"),
    );
    expect(new URLSearchParams(query).get("sig")).toBe("abc");
  });
});

describe("isSignedConsentQuery", () => {
  it("asks whether the query claims a signature", () => {
    expect(isSignedConsentQuery(SIGNED)).toBe(true);
    expect(isSignedConsentQuery(REDIRECT)).toBe(false);
  });
});

describe("httpsOnlyLink", () => {
  it("keeps an https link", () => {
    expect(httpsOnlyLink("https://client.example/about")).toBe(
      "https://client.example/about",
    );
  });

  it("drops every other scheme, and junk", () => {
    expect(httpsOnlyLink("http://client.example/about")).toBeUndefined();
    expect(httpsOnlyLink("javascript:alert(1)")).toBeUndefined();
    expect(httpsOnlyLink("data:text/html,hi")).toBeUndefined();
    expect(httpsOnlyLink("not a url")).toBeUndefined();
    expect(httpsOnlyLink(null)).toBeUndefined();
  });
});
