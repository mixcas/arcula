/**
 * Provision the GitHub Actions deploy identity, idempotently: the OIDC
 * provider, and one role per long-lived branch. Each role trusts exactly
 * its own branch (and the GitHub Environment its job runs in) and may do
 * one thing — assume the account's CDK bootstrap roles, which is all a
 * deploy needs.
 *
 *   node scripts/provision-oidc.mjs [owner/repo]
 *
 * The repository defaults to the origin remote, so a re-run is a no-op and
 * a rename is followed by editing the trust, not by creating a second
 * role. Safe to run against a provider and roles that already exist: the
 * trust and permission policies are rewritten in place.
 *
 * There are no long-lived keys anywhere in this: the roles are what a
 * workflow assumes, and the workflow gets its credential from GitHub's OIDC
 * token.
 *
 * The isolation this buys is one-directional and should not be
 * over-claimed: neither role can read the other environment's secrets, but
 * both can assume the same bootstrap roles in the shared account, so a
 * modified workflow on one branch can reach the other environment's stack.
 * That trade is recorded and accepted rather than mitigated.
 */
import { execFileSync } from "node:child_process";

/** The long-lived branches and the GitHub Environment each deploy runs in. */
const BRANCHES = [
  {
    branch: "dev",
    githubEnvironment: "dev",
    role: "ArculaDeployDev",
    description: "GitHub Actions deploy identity for the dev branch",
  },
  {
    branch: "main",
    githubEnvironment: "production",
    role: "ArculaDeployProd",
    description: "GitHub Actions deploy identity for the main branch",
  },
];

const PROVIDER_URL = "https://token.actions.githubusercontent.com";

/** `git@github.com:owner/repo.git` and its https/ssh spellings → `owner/repo`. */
function repoFromRemote(remote) {
  const match = remote.match(
    /github\.com[:/](?<repo>[^/]+\/[^/]+?)(?:\.git)?$/,
  );
  return match?.groups?.repo ?? null;
}

const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
  encoding: "utf8",
}).trim();
const repo = (process.argv[2] ?? repoFromRemote(remote) ?? "").trim();

if (!/^[^/]+\/[^/]+$/.test(repo)) {
  console.error(
    `could not read owner/repo from the origin remote (${remote}) — ` +
      "pass it: node scripts/provision-oidc.mjs <owner>/<repo>",
  );
  process.exit(2);
}

/** Run the AWS CLI, or fail loudly with its stderr. */
const aws = (args, { allowFailure = false } = {}) => {
  try {
    return execFileSync("aws", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (!allowFailure) {
      process.stderr.write(error.stderr ?? "");
      throw error;
    }
    return null;
  }
};

const account = aws([
  "sts",
  "get-caller-identity",
  "--query",
  "Account",
  "--output",
  "text",
]);
console.log(`==> account ${account}, repository ${repo}`);

// The identity provider. AWS now derives the provider's CA from the URL, so
// no thumbprint is supplied (a supplied one would be ignored).
const providers =
  JSON.parse(aws(["iam", "list-open-id-connect-providers", "--output", "json"]))
    .OpenIDConnectProviderList ?? [];
let providerArn = providers.find((provider) =>
  provider.Arn.endsWith("/token.actions.githubusercontent.com"),
)?.Arn;

if (providerArn) {
  console.log(`==> reusing OIDC provider ${providerArn}`);
} else {
  providerArn = aws([
    "iam",
    "create-open-id-connect-provider",
    "--url",
    PROVIDER_URL,
    "--client-id-list",
    "sts.amazonaws.com",
    "--query",
    "OpenIDConnectProviderArn",
    "--output",
    "text",
  ]);
  console.log(`==> created OIDC provider ${providerArn}`);
}

// Only the bootstrap roles: the CDK CLI assumes the deploy, file-publish and
// lookup roles from there, and they carry the actual permissions. `cdk-*`
// covers whatever qualifier the bootstrap was created with.
const permissions = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: "sts:AssumeRole",
      Resource: `arn:aws:iam::${account}:role/cdk-*`,
    },
  ],
});

const provisioned = [];

for (const { branch, githubEnvironment, role, description } of BRANCHES) {
  const trust = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Federated: providerArn },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          },
          // The branch, and the GitHub Environment the deploy job runs in:
          // a job that sets `environment:` presents `environment:<name>` as
          // its subject instead of the branch ref, so both are trusted.
          StringLike: {
            "token.actions.githubusercontent.com:sub": [
              `repo:${repo}:ref:refs/heads/${branch}`,
              `repo:${repo}:environment:${githubEnvironment}`,
            ],
          },
        },
      },
    ],
  });

  const existing = aws(
    [
      "iam",
      "get-role",
      "--role-name",
      role,
      "--query",
      "Role.Arn",
      "--output",
      "text",
    ],
    { allowFailure: true },
  );

  let roleArn;
  if (existing) {
    aws([
      "iam",
      "update-assume-role-policy",
      "--role-name",
      role,
      "--policy-document",
      trust,
    ]);
    roleArn = existing;
    console.log(`==> updated role ${role} (${branch})`);
  } else {
    roleArn = aws([
      "iam",
      "create-role",
      "--role-name",
      role,
      "--description",
      description,
      "--assume-role-policy-document",
      trust,
      "--query",
      "Role.Arn",
      "--output",
      "text",
    ]);
    console.log(`==> created role ${role} (${branch})`);
  }

  aws([
    "iam",
    "put-role-policy",
    "--role-name",
    role,
    "--policy-name",
    "AssumeCdkBootstrapRoles",
    "--policy-document",
    permissions,
  ]);
  provisioned.push({ branch, roleArn });
}

console.log(
  "\n==> deploy roles (set these as AWS_DEPLOY_ROLE in the GitHub Environments):",
);
for (const { branch, roleArn } of provisioned) {
  console.log(`     ${branch.padEnd(5)} ${roleArn}`);
}
