// The environment conditionals the stack carries, and only those: the
// dev-only function environment, the per-environment stack identity, artifact
// and API display name. The stack's unconditional resources and the
// template's shape are deliberately not asserted — a snapshot of those would
// only ever fail on a dependency upgrade, which is the failure this suite
// does not want to produce.

import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArculaStack } from "../src/arcula-stack";
import {
  ENVIRONMENTS,
  parseEnvironment,
  type EnvironmentName,
} from "../src/environments";

// CDK validates an asset's path when the function is constructed, so the
// stack is pointed at a throwaway directory holding both environments'
// artifacts rather than depending on a built package.
let assetDirectory: string;

beforeAll(() => {
  assetDirectory = mkdtempSync(path.join(tmpdir(), "arcula-cdk-"));
  writeFileSync(path.join(assetDirectory, "arcula-api.zip"), "");
  writeFileSync(path.join(assetDirectory, "arcula-api-dev.zip"), "");
});

afterAll(() => {
  rmSync(assetDirectory, { recursive: true, force: true });
});

function stackFor(
  environment: EnvironmentName,
  context?: Record<string, string>,
): ArculaStack {
  const app = new cdk.App({ context });
  return new ArculaStack(app, ENVIRONMENTS[environment].stackName, {
    environment,
    lambdaArtifactDirectory: assetDirectory,
  });
}

interface LambdaResource {
  Properties?: { Environment?: { Variables?: Record<string, string> } };
}

/** The variables wired into the stack's Lambda function, off the template. */
function functionVariables(stack: ArculaStack): Record<string, string> {
  const resources = Template.fromStack(stack).findResources(
    "AWS::Lambda::Function",
  ) as unknown as Record<string, LambdaResource>;
  const [fn] = Object.values(resources);
  return fn?.Properties?.Environment?.Variables ?? {};
}

function apiDisplayName(stack: ArculaStack): string | undefined {
  const resources = Template.fromStack(stack).findResources(
    "AWS::ApiGatewayV2::Api",
  ) as unknown as Record<string, { Properties?: { Name?: string } }>;
  const [api] = Object.values(resources);
  return api?.Properties?.Name;
}

describe("the environment selector", () => {
  it("requires one of the two names and refuses anything else", () => {
    expect(parseEnvironment("prod")).toBe("prod");
    expect(parseEnvironment("dev")).toBe("dev");
    expect(() => parseEnvironment(undefined)).toThrow();
    expect(() => parseEnvironment("staging")).toThrow();
  });
});

describe("the stack identity", () => {
  it("differs by stack name and description between the two environments", () => {
    const dev = stackFor("dev");
    const prod = stackFor("prod");
    expect(dev.stackName).not.toBe(prod.stackName);
    expect(dev.templateOptions.description).not.toBe(
      prod.templateOptions.description,
    );
  });
});

describe("the dev-only function environment", () => {
  const commit = "commit-under-test";

  it("is present on the dev stack", () => {
    const variables = functionVariables(
      stackFor("dev", { DEPLOYED_COMMIT: commit }),
    );
    expect(variables.DEPLOYED_COMMIT).toBe(commit);
    expect(variables.NOINDEX).toBe("true");
  });

  it("is absent from the production stack", () => {
    const variables = functionVariables(stackFor("prod"));
    expect(variables).not.toHaveProperty("DEPLOYED_COMMIT");
    expect(variables).not.toHaveProperty("NOINDEX");
  });
});

describe("the Lambda artifact", () => {
  it("is the dev artifact on dev and production's on prod", () => {
    const dev = stackFor("dev").lambdaArtifactPath;
    const prod = stackFor("prod").lambdaArtifactPath;
    expect(dev.endsWith("arcula-api-dev.zip")).toBe(true);
    expect(prod.endsWith("arcula-api.zip")).toBe(true);
  });
});

describe("the API display name", () => {
  it("differs between the two environments", () => {
    const dev = apiDisplayName(stackFor("dev"));
    const prod = apiDisplayName(stackFor("prod"));
    expect(dev).not.toBe(prod);
  });
});
