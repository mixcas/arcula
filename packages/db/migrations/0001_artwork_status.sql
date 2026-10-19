ALTER TABLE "artworks" ADD COLUMN "status" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
-- Hand-appended backfill: the owner's old per-work flag is the only record of
-- the choice, so a work whose flag was false becomes a draft. Every other work
-- keeps the column's `published` default.
UPDATE "artworks" SET "status" = 'draft' WHERE "isPublic" = false;--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_status_check" CHECK ("status" in ('draft', 'published'));
