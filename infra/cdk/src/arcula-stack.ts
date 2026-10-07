/**
 * The beta stack (Phase 6, plan §10, amended): the Lambda shape.
 *
 * One Lambda runs the whole product — API and built SPA (plan §10.2, one
 * artifact behind one origin) — behind an HTTP API; S3 holds the media;
 * Postgres lives in Supabase (created out of band on the free tier,
 * reached over its public connection string). No VPC, no ALB, no ECS:
 * the owner's ruling is an idle beta at ~$0–3/mo, and every one of those
 * constructs was a 24/7 line item (see the §15 cost ruling).
 *
 * Values never live in this app (plan §10.1): the secrets arrive at
 * deploy time as CDK context (`cdk deploy -c DATABASE_URL=… -c
 * AUTH_SECRET=… -c RESEND_API_KEY=… -c PUBLIC_URL=…`), and the deploy
 * script enforces their presence before the deploy. At synth, absent
 * context falls back to placeholders, so `cdk synth` stays green with no
 * AWS account and no secrets.
 *
 * PUBLIC_URL is two-step by construction: the HTTP API's URL only exists
 * after the first deploy, so the deploy script deploys once, reads the
 * ExecuteApiUrl output, and re-deploys with the real URL (the Lambda is
 * stateless — the re-deploy costs nothing; Phase 7's custom domain makes
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
    // the same rule the local self-heal counts on (§6).
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

    // For the two-step PUBLIC_URL deploy and the S5 verification.
    new cdk.CfnOutput(this, "ExecuteApiUrl", { value: api.url! });
    new cdk.CfnOutput(this, "MediaBucket", { value: media.bucketName });
  }
}
