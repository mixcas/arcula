import * as cdk from "aws-cdk-lib";
import { ArculaStack } from "./arcula-stack";

const app = new cdk.App();

new ArculaStack(app, "Arcula", {
  description:
    "Arcula beta (Phase 6, plan §10): one Lambda (API + built SPA) behind " +
    "an HTTP API, S3 for media; Postgres lives in Supabase (out of band, " +
    "free tier). Region comes from --region (us-east-1 locked, §10.3). " +
    "DOMAIN/CERT_ARN arrive in Phase 7 (custom domain + ACM).",
});
