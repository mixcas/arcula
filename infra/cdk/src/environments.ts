// The two environments Arcula deploys, as a table.
//
// Which one a synthesis is arrives as CDK context (`-c ENV=prod` or
// `-c ENV=dev`) and is required — `parseEnvironment` has no default, because
// a default is how the wrong environment gets deployed by omission. One
// invocation synthesises exactly one stack, so an unnamed `cdk deploy` can
// never touch both environments.
//
// Only what must differ between environments lives here: the stack's name
// and description, its HTTP API display name, and its Lambda artifact.
// Construct ids and logical ids never vary with the environment, which is
// what keeps production's template unchanged.

export type EnvironmentName = "prod" | "dev";

export interface EnvironmentConfig {
  /** The CloudFormation stack name (and the app's stack id). */
  readonly stackName: string;
  /** The stack's CloudFormation description, so the console distinguishes it. */
  readonly description: string;
  /** The HTTP API's display name. */
  readonly apiName: string;
  /** This environment's Lambda artifact filename, under dist/lambda/. */
  readonly lambdaArtifact: string;
  /**
   * Whether the dev-only Lambda environment (the deployed commit and the
   * noindex flag) applies. False on production, so those values cannot be
   * wired in by accident.
   */
  readonly devOnly: boolean;
}

// The shape both environments share; only the prefix differs.
const STACK_BODY =
  "one Lambda (API + built SPA) behind an HTTP API, S3 for media; " +
  "Postgres lives in Supabase (out of band, free tier). Region comes from " +
  "--region (us-east-1 locked). DOMAIN/CERT_ARN enable the custom domain.";

export const ENVIRONMENTS: Record<EnvironmentName, EnvironmentConfig> = {
  prod: {
    stackName: "Arcula",
    description: `Arcula: ${STACK_BODY}`,
    apiName: "arcula",
    lambdaArtifact: "arcula-api.zip",
    devOnly: false,
  },
  dev: {
    stackName: "ArculaDev",
    description: `Arcula dev: ${STACK_BODY}`,
    apiName: "arcula-dev",
    lambdaArtifact: "arcula-api-dev.zip",
    devOnly: true,
  },
};

/**
 * The environment named by CDK context, or a loud failure. Anything other
 * than the exact strings `prod` and `dev` — including an absent value —
 * throws, so synthesis never proceeds without knowing which environment it
 * is.
 */
export function parseEnvironment(value: unknown): EnvironmentName {
  if (value === "prod" || value === "dev") return value;
  throw new Error(
    `ENV must be "prod" or "dev" (got ${JSON.stringify(value)}) — ` +
      `pass -c ENV=prod or -c ENV=dev`,
  );
}
