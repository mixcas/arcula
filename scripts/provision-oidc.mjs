/**
 * Provision the GitHub Actions deploy identity, idempotently: the OIDC
 * provider, and one role per long-lived branch. Each role trusts exactly
 * its own branch (and the GitHub Environment its job runs in), may assume
 * the account's CDK bootstrap roles — which is how a deploy changes
 * anything — and may read back the stack and function it just deployed.
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

// The repository's numeric IDs, which the OIDC subject now carries.
//
// GitHub moved to immutable subject claims: a token from a repository that
// was created, renamed or transferred after 2026-07-15 presents
//
//   repo:owner@<owner-id>/repo@<repo-id>:environment:dev
//
// rather than `repo:owner/repo:environment:dev`. A trust policy written with
// the names alone then matches nothing, and every deploy dies at assume-role
// with "Not authorized to perform sts:AssumeRoleWithWebIdentity". The IDs do
// not change when the repository is renamed, so they are also the spelling
// that survives one.
let repoIds;
try {
  repoIds = JSON.parse(
    execFileSync(
      "gh",
      ["api", `repos/${repo}`, "--jq", "{ownerId: .owner.id, repoId: .id}"],
      { encoding: "utf8" },
    ),
  );
} catch (error) {
  process.stderr.write(error.stderr ?? "");
  console.error(
    `could not read the repository's IDs with gh (needed for the OIDC subject) — ` +
      "is gh installed and signed in?",
  );
  process.exit(2);
}
const [owner, name] = repo.split("/");
const immutableRepo = `repo:${owner}@${repoIds.ownerId}/${name}@${repoIds.repoId}`;

console.log(`==> account ${account}, repository ${repo}`);
console.log(`    subject repo: ${immutableRepo}`);

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

// What a deploy reads back after writing: the stack's outputs (API URL,
// function name, the custom domain's regional endpoints) and the function's
// configuration, which is the seed's environment. Nothing that changes
// anything is here — that still goes through the bootstrap roles — so this
// stays read-only and account-scoped.
const readBack = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: "cloudformation:DescribeStacks",
      Resource: `arn:aws:cloudformation:*:${account}:stack/*`,
    },
    {
      Effect: "Allow",
      Action: "lambda:GetFunctionConfiguration",
      Resource: `arn:aws:lambda:*:${account}:function:*`,
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
          //
          // Both spellings of the repository's name are listed. The immutable
          // one (with IDs) is what GitHub issues for this repository; the
          // name-only one is what a repository created before 2026-07-15
          // that has never been renamed still issues. Neither can be reached
          // by a workflow this repository does not own.
          StringLike: {
            "token.actions.githubusercontent.com:sub": [
              `repo:${repo}:ref:refs/heads/${branch}`,
              `repo:${repo}:environment:${githubEnvironment}`,
              `${immutableRepo}:ref:refs/heads/${branch}`,
              `${immutableRepo}:environment:${githubEnvironment}`,
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
  aws([
    "iam",
    "put-role-policy",
    "--role-name",
    role,
    "--policy-name",
    "ReadDeploymentResults",
    "--policy-document",
    readBack,
  ]);
  provisioned.push({ branch, roleArn });
}

console.log(
  "\n==> deploy roles (set these as AWS_DEPLOY_ROLE in the GitHub Environments):",
);
for (const { branch, roleArn } of provisioned) {
  console.log(`     ${branch.padEnd(5)} ${roleArn}`);
}
