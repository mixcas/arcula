# Arcula — AWS CDK (placeholder)

The CDK app for the Arcula backend (migration plan §10): VPC, RDS Postgres
16, S3 (with the `staging/` lifecycle rule), SecretsManager, ECR + ECS
Fargate, ALB, CloudWatch.

Lands in Phase 6. Deliberately **not** a workspace member: it is standalone
TypeScript with its own `bun install` when it materializes, and the CDK
constructs never import application code (secrets are referenced by name, not
value). Until then this directory holds this file and nothing else.
