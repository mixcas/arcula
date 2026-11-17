import type { KnipConfig } from "knip";

// Dead-code findings are the gate's, not a backlog: the tree lands with no
// ignore list, so the next finding is new rather than sediment. Entry points
// are the places a process starts; test helpers are entries too, because a
// helper's exports exist for the tests that import them.
//
// `infra/cdk` is added as a project rather than a workspace member: it is
// deliberately outside the Bun workspaces and installs its own dependencies,
// but its sources are still ours to check.
//
// `scripts/lambda-smoke.mjs` is out of the project on purpose. It is copied
// into the Lambda stage by `scripts/build-lambda.sh` and run there, so its
// `./index.js` and `./smoke.js` imports and its `sharp` come from that staged
// package, not from this one; analysing it here would only report the staging
// arrangement as three findings. The vendored skills and the OpenCode plugin
// are likewise not this product's sources.
const config: KnipConfig = {
  // A component's prop type is API even when knip cannot tell it from a dead
  // one, and enum members are read through their enum. Both stay review calls.
  exclude: ["types", "enumMembers"],
  workspaces: {
    ".": {
      entry: ["scripts/*.{js,mjs,ts}", "!scripts/lambda-smoke.mjs"],
      project: ["scripts/**/*.{js,mjs,ts}", "!scripts/lambda-smoke.mjs"],
    },
    "apps/api": {
      entry: [
        "src/lambda.ts",
        "scripts/deploy-verify.ts",
        "scripts/lambda-smoke-entry.ts",
        "scripts/db-drop.ts",
        "tests/helpers/**",
      ],
      project: ["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"],
    },
    "apps/web": {
      entry: ["index.html", "tests/helpers/**"],
      project: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    },
    "packages/shared": {
      project: ["src/**/*.ts", "tests/**/*.ts"],
    },
    "packages/db": {
      project: ["src/**/*.ts", "tests/**/*.ts"],
    },
    "infra/cdk": {
      entry: ["src/main.ts", "tests/**/*.test.ts"],
      project: ["src/**/*.ts", "tests/**/*.ts"],
    },
  },
};

export default config;
