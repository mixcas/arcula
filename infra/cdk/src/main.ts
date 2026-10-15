import * as cdk from "aws-cdk-lib";
import { ArculaStack } from "./arcula-stack";

const app = new cdk.App();

new ArculaStack(app, "Arcula", {
  description:
    "Arcula beta: one Lambda (API + built SPA) behind " +
    "an HTTP API, S3 for media; Postgres lives in Supabase (out of band, " +
    "free tier). Region comes from --region (us-east-1 locked). " +
    "DOMAIN/CERT_ARN enable the custom domain.",
});
