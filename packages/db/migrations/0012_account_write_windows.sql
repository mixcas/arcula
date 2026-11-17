CREATE TABLE "account_write_windows" (
	"userId" text NOT NULL,
	"bucket" text NOT NULL,
	"windowStart" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "account_write_windows_userId_bucket_windowStart_pk" PRIMARY KEY("userId","bucket","windowStart"),
	CONSTRAINT "account_write_windows_bucket_check" CHECK ("bucket" in ('write', 'import'))
);
--> statement-breakpoint
ALTER TABLE "account_write_windows" ENABLE ROW LEVEL SECURITY;
-- Hand-appended lock-down: 0006 locked down the tables that existed then, and
-- this one ships after it, so its own migration carries the same treatment.
-- RLS is on above (generated from `enableRLS()`); a grant lives in Postgres's
-- ACL, not in the schema declaration, so drizzle-kit has no fact to render and
-- the revoke below is written by hand. The client roles lose the table whether
-- or not the platform's `ALTER DEFAULT PRIVILEGES` from 0006 reaches it.
--
-- The existence guard is why this migration is portable: Supabase creates
-- `anon` and `authenticated`, while the local stack and CI have neither, so a
-- bare revoke would fail every `db:migrate` with `role "anon" does not exist`.
--
-- Deliberately NOT `FORCE ROW LEVEL SECURITY`: the application connects as the
-- table owner, which bypasses RLS. FORCE would subject the owner to the empty
-- policy set and blank every read, insert and the seed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "account_write_windows" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "account_write_windows" FROM authenticated;
  END IF;
END $$;
