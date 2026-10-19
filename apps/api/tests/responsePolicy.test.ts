// The environment-derived decisions, as tables.
//
// Pure — no server, no ambient configuration: each rule reads only its
// explicit inputs, which is what lets the running app be a thin caller of
// them. Each table is an independent, worked example (not the code restated),
// so changing the rule — the alias comparison, the commit condition, the flag
// check — turns a row red.

import { describe, expect, it } from "vitest";
import {
  canonicalRedirect,
  healthBody,
  noindexEnabled,
} from "../src/responsePolicy";

interface CanonicalCase {
  name: string;
  host: string;
  origin: string;
  url: string;
  expected: string | null;
}

describe("canonicalRedirect", () => {
  const cases: CanonicalCase[] = [
    {
      name: "redirects the origin's www alias to the origin, path and query kept",
      host: "www.arcula.art",
      origin: "https://arcula.art",
      url: "https://www.arcula.art/collections/flores-solares?a=1&b=2",
      expected: "https://arcula.art/collections/flores-solares?a=1&b=2",
    },
    {
      name: "redirects the shell at / with an empty search",
      host: "www.arcula.art",
      origin: "https://arcula.art",
      url: "https://www.arcula.art/",
      expected: "https://arcula.art/",
    },
    {
      name: "ignores the alias host's port (TLS is 443)",
      host: "www.arcula.art:443",
      origin: "https://arcula.art",
      url: "https://www.arcula.art/x",
      expected: "https://arcula.art/x",
    },
    {
      name: "matches case-insensitively",
      host: "WWW.Arcula.Art",
      origin: "https://arcula.art",
      url: "https://WWW.Arcula.Art/",
      expected: "https://arcula.art/",
    },
    {
      name: "keeps the port an origin carries — its alias still matches",
      host: "www.localhost:8000",
      origin: "http://localhost:8000",
      url: "http://www.localhost:8000/manage",
      expected: "http://localhost:8000/manage",
    },
    {
      name: "does not double the slash when the origin ends in one",
      host: "www.arcula.art",
      origin: "https://arcula.art/",
      url: "https://www.arcula.art/x",
      expected: "https://arcula.art/x",
    },
    {
      name: "leaves the origin's own host alone",
      host: "arcula.art",
      origin: "https://arcula.art",
      url: "https://arcula.art/",
      expected: null,
    },
    {
      name: "leaves the origin's own host alone when it carries a port",
      host: "localhost:8000",
      origin: "http://localhost:8000",
      url: "http://localhost:8000/",
      expected: null,
    },
    {
      name: "leaves a www host that is not the origin's alias alone",
      host: "www.other-art.example",
      origin: "https://arcula.art",
      url: "https://www.other-art.example/",
      expected: null,
    },
    {
      name: "does not treat www.<origin> as its own alias (no www.www)",
      host: "www.www.arcula.art",
      origin: "https://arcula.art",
      url: "https://www.www.arcula.art/",
      expected: null,
    },
    {
      name: "never redirects with an empty origin",
      host: "www.arcula.art",
      origin: "",
      url: "https://www.arcula.art/",
      expected: null,
    },
    {
      name: "never redirects with a non-http origin",
      host: "www.arcula.art",
      origin: "ftp://arcula.art",
      url: "https://www.arcula.art/",
      expected: null,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(canonicalRedirect(c.host, c.origin, c.url)).toBe(c.expected);
    });
  }
});

describe("healthBody", () => {
  const cases: Array<{
    commit: string;
    expected: { status: "ok"; commit?: string };
    hasCommit: boolean;
  }> = [
    {
      commit: "abc1234",
      expected: { status: "ok", commit: "abc1234" },
      hasCommit: true,
    },
    { commit: "", expected: { status: "ok" }, hasCommit: false },
  ];

  for (const c of cases) {
    it(`for commit ${JSON.stringify(c.commit)}`, () => {
      const body = healthBody(c.commit);
      expect(body).toEqual(c.expected);
      // toEqual ignores an undefined-key; this is the assertion that the key
      // is genuinely absent when no commit is configured — production's body.
      expect("commit" in body).toBe(c.hasCommit);
    });
  }
});

describe("noindexEnabled", () => {
  const cases: Array<[string | undefined, boolean]> = [
    ["true", true],
    ["1", false],
    ["false", false],
    ["TRUE", false],
    ["", false],
    [undefined, false],
  ];

  for (const [flag, expected] of cases) {
    it(`reads ${JSON.stringify(flag)} as ${expected}`, () => {
      expect(noindexEnabled(flag)).toBe(expected);
    });
  }
});
