/**
 * Provision one host's TLS certificate: request it (or reuse the one that
 * already exists for the host), print the DNS validation record to publish,
 * poll until it is issued, and print the ARN the environment's file needs.
 *
 *   node scripts/provision-cert.mjs <host>
 *
 * The certificate lives in us-east-1, the one region an API Gateway HTTP
 * API custom domain can use. DNS has no API access here, so the record is
 * printed for a human to publish in the console; the script is safe to
 * re-run while waiting (a certificate for the host is reused rather than
 * requested a second time).
 *
 * The routing record is a different thing from the validation record: it is
 * the ALIAS/CNAME that makes the host answer, and its target is the stack's
 * own regional endpoint — which does not exist until the environment has
 * been deployed once. So it is printed in the shape it will take, and
 * `scripts/deploy.sh` prints the exact values once it can read them off the
 * stack.
 */
import { execFileSync } from "node:child_process";

const REGION = "us-east-1";
const host = (process.argv[2] ?? "").trim();

if (!host) {
  console.error("usage: node scripts/provision-cert.mjs <host>");
  process.exit(2);
}

/** Run the AWS CLI, or fail loudly with its stderr. */
const aws = (args) => {
  try {
    return execFileSync("aws", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    process.stderr.write(error.stderr ?? "");
    throw error;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A re-run while waiting for DNS must not pile up certificates for the same
// host, so an existing one that is not dead is reused.
const certificates =
  JSON.parse(
    aws(["acm", "list-certificates", "--region", REGION, "--output", "json"]),
  ).CertificateSummaryList ?? [];
const dead = new Set(["FAILED", "EXPIRED", "REVOKED"]);
let arn = certificates.find(
  (cert) => cert.DomainName === host && !dead.has(cert.Status),
)?.CertificateArn;

if (arn) {
  console.log(`==> reusing certificate ${arn}`);
} else {
  // The apex's certificate carries www as a SAN, so one certificate backs
  // both of a host's domain-name pairs.
  const sans = host.startsWith("www.") ? [] : [`www.${host}`];
  arn = aws([
    "acm",
    "request-certificate",
    "--region",
    REGION,
    "--domain-name",
    host,
    ...(sans.length > 0 ? ["--subject-alternative-names", ...sans] : []),
    "--validation-method",
    "DNS",
    "--query",
    "CertificateArn",
    "--output",
    "text",
  ]);
  console.log(`==> requested certificate ${arn}`);
}

// Poll until the certificate is issued. Validation waits on a human
// publishing the record below, and DNS propagation has no upper bound worth
// guessing, so this polls until it is issued rather than giving up on a
// timer: the record is printed once, a status line follows each attempt, and
// interrupting it is safe — a re-run reuses the same certificate.
const INTERVAL_MS = 10_000;
let printedValidation = false;

for (let attempt = 0; ; attempt++) {
  const { Certificate: cert } = JSON.parse(
    aws([
      "acm",
      "describe-certificate",
      "--region",
      REGION,
      "--certificate-arn",
      arn,
      "--query",
      "Certificate",
      "--output",
      "json",
    ]),
  );

  if (cert.Status === "FAILED") {
    console.error(`\ncertificate ${arn} failed validation`);
    process.exit(1);
  }

  if (cert.Status === "ISSUED") break;

  // Right after the request the options can still be empty, so the record
  // is printed on the first attempt that actually has one — not merely the
  // first attempt.
  const records = (cert.DomainValidationOptions ?? [])
    .map((option) => option.ResourceRecord)
    .filter(Boolean);
  if (!printedValidation && records.length > 0) {
    console.log(
      "==> publish this DNS validation record, then leave this running:",
    );
    for (const record of records) {
      console.log(`     ${record.Type}  ${record.Name}  ${record.Value}`);
    }
    printedValidation = true;
  }

  const elapsed = ((attempt + 1) * INTERVAL_MS) / 1000;
  console.log(`     waiting for validation: ${cert.Status} (${elapsed}s)`);
  await sleep(INTERVAL_MS);
}

console.log(`\n==> certificate issued: ${arn}`);
console.log("     put it in this environment's file as CERT_ARN");

// The routing record: what the host must point at once the environment is
// deployed, so the API answers on it. Its target only exists after that
// first deploy, so its exact value comes from the stack's outputs.
console.log(
  "\n==> routing record (publish after this environment's first deploy):",
);
console.log(
  `     apex  ${host}  ALIAS -> the stack's ApiRegionalDomainName output ` +
    "(hosted zone: ApiRegionalHostedZone)",
);
if (!host.startsWith("www.")) {
  console.log(
    `     www   www.${host}  CNAME -> the stack's ApiRegionalDomainNameForwww output`,
  );
}
console.log("     (scripts/deploy.sh prints both against their exact values)");
