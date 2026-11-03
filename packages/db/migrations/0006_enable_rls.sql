ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artwork_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artwork_photo_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artwork_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artworks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collection_access_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collection_collaborators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collection_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collection_unlock_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-appended lock-down: drizzle-kit models tables, never their grants, so
-- the two PostgREST roles are revoked here rather than generated. RLS with no
-- policies already denies them, but the revoke means a table added later starts
-- closed even before its own migration enables RLS, and it closes the surface
-- for a reader of `public` that never consults RLS at all.
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
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
  END IF;
END $$;