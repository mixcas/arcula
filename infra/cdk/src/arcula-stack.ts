/**
 * The beta stack: the Lambda shape.
 *
 * One Lambda runs the whole product — API and built SPA (one artifact behind
 * one origin) — behind an HTTP API; S3 holds the media;
 * Postgres lives in Supabase (created out of band on the free tier,
 * reached over its public connection string). No VPC, no ALB, no ECS:
 * the owner's ruling is an idle beta at ~$0–3/mo, and every one of those
 * constructs was a 24/7 line item.
 *
 * Values never live in this app: the secrets arrive at
 * deploy time as CDK context (`cdk deploy -c DATABASE_URL=… -c
 * AUTH_SECRET=… -c RESEND_API_KEY=… -c PUBLIC_URL=…`), and the deploy
 * script enforces their presence before the deploy. At synth, absent
 * context falls back to placeholders, so `cdk synth` stays green with no
 * AWS account and no secrets.
 *
 * PUBLIC_URL is two-step by construction: the HTTP API's URL only exists
 * after the first deploy, so the deploy script deploys once, reads the
 * ExecuteApiUrl output, and re-deploys with the real URL (the Lambda is
 * stateless — the re-deploy costs nothing; the custom domain makes
 * the URL stable for good).
 */
import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as path from "node:path";

export class ArculaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const contextValue = (name: string, fallback: string): string => {
      // tryGetContext is typed `any` in CDK; only a string is a value we
      // put in a Lambda env, anything else falls to the placeholder.
      const value: unknown = this.node.tryGetContext(name);
      return typeof value === "string" ? value : fallback;
    };

    // Media: private, encrypted, and the staging/ prefix self-expires —
    // the same rule the local self-heal counts on.
    const media = new s3.Bucket(this, "Media", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        { prefix: "staging/", expiration: cdk.Duration.days(7) },
      ],
    });

    // The product: API + built SPA in one function. The package is built
    // by scripts/build-lambda.sh (code bundle + Sharp's native prebuilt +
    // a fresh web build), smoked in a glibc container before it ships.
    // ARM_64 to match the package (and the t4g scale-up path).
    // nodejs24.x: nodejs20.x is deprecated (creation disabled 2027-02-01);
    // Sharp rides the stable N-API, so the smoke carries over. 3008 MB is
    // Lambda's hard memory cap — Sharp's 12 MP headroom.
    const fn = new lambda.Function(this, "ApiFunction", {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../../dist/lambda/arcula-api.zip"),
      ),
      handler: "index.handler",
      memorySize: 3008,
      timeout: cdk.Duration.seconds(300),
      environment: {
        // Production so Better Auth marks the session cookie
        // `Secure` (auth.ts gates `useSecureCookies` on this). Local dev is
        // plain http, where a Secure cookie is rejected — which is why the
        // code gates on NODE_ENV rather than hardcoding `true`, and why the
        // lambda is the only place that sets it.
        NODE_ENV: "production",
        // Supabase (out of band): the connection string, not a cluster.
        DATABASE_URL: contextValue("DATABASE_URL", ""),
        AUTH_SECRET: contextValue("AUTH_SECRET", ""),
        // The one public origin: the API, the SPA, and the mail links all
        // live on it (same-origin by design — no CORS to configure).
        AUTH_BASE_URL: contextValue("PUBLIC_URL", "http://localhost:8000"),
        CLIENT_ORIGIN: contextValue("PUBLIC_URL", "http://localhost:8000"),
        CORS_ORIGINS: contextValue("PUBLIC_URL", "http://localhost:8000"),
        // Mail: Resend in prod (SMTP from a Lambda is the path we did not
        // take; nodemailer stays for the local SMTP provider).
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: contextValue("RESEND_API_KEY", ""),
        EMAIL_FROM: contextValue("EMAIL_FROM", "Arcula <noreply@arcula.art>"),
        // S3: the SDK gets the endpoint explicitly (storage.ts refuses to
        // fall through to a default) and the credentials from its own IAM
        // role (storage.ts's default-chain branch) — no long-lived keys.
        S3_ENDPOINT: `https://s3.${this.region}.amazonaws.com`,
        S3_REGION: this.region,
        S3_BUCKET: media.bucketName,
        // The SPA the Lambda serves (spa.ts).
        WEB_DIST: "/var/task/web/dist",
      },
    });

    // Reach only this bucket; the app does put/get/head/delete/list, which
    // is exactly grantReadWrite's surface (HeadObject is covered by
    // GetObject, ListObjectsV2 by ListBucket).
    media.grantReadWrite(fn);

    // One catch-all route: /api/* and the SPA share the function, exactly
    // as locally — spa.ts is what splits them. `{proxy+}` is the HTTP
    // API's greedy catch-all parameter (what HttpApi.addProxy() generates;
    // `{$proxy}` is REST-API syntax and the `$` fails the path-part
    // validation). The integration timeout is an HTTP-API hard cap of 29 s
    // — set it on purpose: the measured worst case (a 10-photo save) is
    // single digits, and a request that outgrows 29 s is a signal to move
    // the work off the request path, not to wait longer for it.
    const api = new apigw.HttpApi(this, "Api", { apiName: "arcula" });
    api.addRoutes({
      path: "/{proxy+}",
      methods: [apigw.HttpMethod.ANY],
      integration: new integrations.HttpLambdaIntegration("Api", fn, {
        timeout: cdk.Duration.seconds(29),
      }),
    });

    // For the two-step PUBLIC_URL deploy and the prod verification.
    new cdk.CfnOutput(this, "ExecuteApiUrl", { value: api.url! });
    new cdk.CfnOutput(this, "MediaBucket", { value: media.bucketName });

    // An optional custom domain on the HTTP API.
    // Gated on `DOMAIN` so the beta deploys (no domain) are byte-for-byte
    // unchanged; the two-step PUBLIC_URL deploy still uses the execute-api
    // name. API Gateway HTTP-API custom domains are a per-name pair — a
    // `DomainName` (provisioned in API Gateway, carrying the us-east-1 ACM
    // cert) and an `ApiMapping` (domain → the API's $default stage at the
    // root path, so the SPA at "/" and the API at "/api/*" both serve
    // under it). They need a construct the beta's aws-cdk-lib does not ship
    // (that submodule is pruned), so they are declared as CloudFormation —
    // the resource + property shapes are pinned below, and CI-equivalent is
    // a synth that shows them.
    //
    // Each NAME is its own pair, because HTTP-API custom domains do not
    // inherit a parent: a `DomainName` of `arcula.art` serves only the
    // exact host `arcula.art`. A request for `www.arcula.art` reaches the
    // same regional endpoint (their DNS resolves there) but is rejected
    // there with `403 ForbiddenException` (x-amzn-errortype) — API Gateway
    // sees a host with no matching pair, before the Lambda runs — so the
    // www host is an explicit second pair over the same API + stage.
    const domainName = contextValue("DOMAIN", "");
    if (domainName) {
      const certArn = contextValue("CERT_ARN", "");
      // A domain without a cert is incomplete: fail synth loudly rather than
      // map a domain to a stage with no TLS.
      if (!certArn) {
        throw new Error(
          `DOMAIN is set ("${domainName}") but CERT_ARN is empty — request the ACM cert in us-east-1 first`,
        );
      }
      // Build the DomainName + root-ApiMapping pair for one host. The root
      // mapping key ("") serves both the SPA at "/" and the API at
      // "/api/*", exactly like the execute-api URL; a key of "api" would
      // hide the SPA. The mapping depends on the provisioned DomainName,
      // which is why addResourceDependency wires it. The cert backs the
      // host's TLS; the same cert already carries www as a SAN, so one
      // ARN serves both pairs. Returns the DomainName for the output below.
      const buildPair = (
        host: string,
        domainId: string,
        mappingId: string,
      ): cdk.CfnResource => {
        const domain = new cdk.CfnResource(this, domainId, {
          type: "AWS::ApiGatewayV2::DomainName",
          properties: {
            DomainName: host,
            // REGIONAL (not EDGE): us-east-1 is the locked region and the
            // only one a cert here can be in. Each configuration element is
            // AWS::ApiGatewayV2::DomainName::DomainNameConfiguration.
            DomainNameConfigurations: [
              { EndpointType: "REGIONAL", CertificateArn: certArn },
            ],
          },
        });
        new cdk.CfnResource(this, mappingId, {
          type: "AWS::ApiGatewayV2::ApiMapping",
          properties: {
            ApiId: api.apiId,
            ApiMappingKey: "",
            DomainName: host,
            Stage: api.defaultStage ? api.defaultStage.stageName : "$default",
          },
        }).addResourceDependency(domain);
        return domain;
      };
      // The apex keeps its existing logical IDs so a redeploy is an
      // in-place update, not a create: replacing ApiDomain/ApiMapping would
      // briefly recreate the live arcula.art. www takes its own distinct IDs
      // (ApiDomainForwww / ApiMappingForwww), so its first deploy creates a
      // resource rather than touching the live apex.
      const apexDomain = buildPair(domainName, "ApiDomain", "ApiMapping");
      const wwwName = domainName.startsWith("www.") ? "" : `www.${domainName}`;
      const wwwDomain = wwwName
        ? buildPair(wwwName, "ApiDomainForwww", "ApiMappingForwww")
        : undefined;
      // Each custom domain's regional endpoint is what the Porkbun records
      // must point at; emitted so the deploy script can hand the
      // exact ALIAS/CNAME target + hosted-zone id to publish. (The
      // references are guarded — these attributes only exist once the
      // DomainName does.) Every DomainName gets its OWN regional endpoint
      // (`d-…`), so www needs its own output: it does NOT equal the apex's,
      // and pointing the www CNAME at the apex target is the exact mistake
      // that 403s.
      new cdk.CfnOutput(this, "ApiRegionalDomainName", {
        // `value` is typed `string`, but its doc permits intrinsic-function
        // tokens (Fn::GetAtt) — the regional endpoint is exactly such a token.
        value: apexDomain.getAtt("RegionalDomainName") as unknown as string,
        description:
          "API Gateway regional endpoint for the apex domain (Porkbun ALIAS target).",
      });
      new cdk.CfnOutput(this, "ApiRegionalHostedZone", {
        value: apexDomain.getAtt("RegionalHostedZoneId") as unknown as string,
        description:
          "Route53 hosted zone for that regional endpoint (Porkbun ALIAS hosted-zone id).",
      });
      if (wwwDomain) {
        new cdk.CfnOutput(this, "ApiRegionalDomainNameForwww", {
          value: wwwDomain.getAtt("RegionalDomainName") as unknown as string,
          description:
            "API Gateway regional endpoint for www (Porkbun www CNAME target).",
        });
      }
    }
  }
}
