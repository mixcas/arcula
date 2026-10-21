-- Hand-appended backfill, before the constraint: rows the old code inserted
-- between 0003 and this release never received a namespace. Their existing
-- keys were built from the owner id, so that is the namespace they resolve
-- through. Scoped to NULL so a namespace the new code minted in the gap is
-- left exactly as it is.
UPDATE "collections" SET "mediaNamespaceId" = "userId" WHERE "mediaNamespaceId" IS NULL;--> statement-breakpoint
ALTER TABLE "collections" ALTER COLUMN "mediaNamespaceId" SET NOT NULL;
