/**
 * Print `KEY='value'` lines for a Lambda function's `Environment.Variables`
 * JSON, for a POSIX shell to `set -a` and source.
 *
 * Values are single-quoted, with a `'` written as `'\''`, so a secret that
 * holds `$`, a backtick or a quote survives the shell unexpanded. Keys are
 * left bare: AWS allows only `[A-Za-z_][A-Za-z0-9_]*` in an environment
 * key, which every shell reads as a name.
 *
 * Used by `scripts/deploy-prod.sh`, whose seed must run with the deployed
 * function's own configuration rather than a second hand-written list.
 *
 *   node scripts/lambda-env-to-dotenv.mjs variables.json > seed.env
 */
import { readFileSync } from "node:fs";

const [, , file] = process.argv;
if (!file) {
  console.error("usage: lambda-env-to-dotenv.mjs <variables.json>");
  process.exit(2);
}

const variables = JSON.parse(readFileSync(file, "utf8"));

// A single-quoted shell string cannot contain a single quote, so it is
// closed, an escaped quote is appended, and it is reopened.
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

for (const [key, value] of Object.entries(variables ?? {})) {
  process.stdout.write(`${key}=${quote(value)}\n`);
}
