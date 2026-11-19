CREATE TABLE "selection_access_grants" (
	"selectionId" text NOT NULL,
	"tokenHash" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	CONSTRAINT "selection_access_grants_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
ALTER TABLE "selection_access_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "selection_unlock_attempts" (
	"ip" text NOT NULL,
	"selectionId" text NOT NULL,
	"windowStart" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "selection_unlock_attempts_ip_selectionId_windowStart_pk" PRIMARY KEY("ip","selectionId","windowStart")
);
--> statement-breakpoint
ALTER TABLE "selection_unlock_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "selection_works" (
	"selectionId" text NOT NULL,
	"artworkId" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "selection_works_selectionId_artworkId_pk" PRIMARY KEY("selectionId","artworkId")
);
--> statement-breakpoint
ALTER TABLE "selection_works" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "selections" (
	"id" text PRIMARY KEY NOT NULL,
	"collectionId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"isPublic" boolean DEFAULT false NOT NULL,
	"passwordHash" text,
	"deletedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "selections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "selection_access_grants_selection_id_idx" ON "selection_access_grants" USING btree ("selectionId");--> statement-breakpoint
CREATE INDEX "selection_works_artwork_id_idx" ON "selection_works" USING btree ("artworkId");
-- Hand-appended lock-down: 0006 locked down the tables that existed then, and
-- these four ship after it, so this migration carries the same treatment for
-- them. RLS is on above (generated from `enableRLS()`); a grant lives in
-- Postgres's ACL, not in the schema declaration, so drizzle-kit has no fact to
-- render and the revoke below is written by hand. The client roles lose the
-- tables whether or not the platform's `ALTER DEFAULT PRIVILEGES` from 0006
-- reaches them.
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
    REVOKE ALL ON "selections" FROM anon;
    REVOKE ALL ON "selection_works" FROM anon;
    REVOKE ALL ON "selection_access_grants" FROM anon;
    REVOKE ALL ON "selection_unlock_attempts" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "selections" FROM authenticated;
    REVOKE ALL ON "selection_works" FROM authenticated;
    REVOKE ALL ON "selection_access_grants" FROM authenticated;
    REVOKE ALL ON "selection_unlock_attempts" FROM authenticated;
  END IF;
END $$;
