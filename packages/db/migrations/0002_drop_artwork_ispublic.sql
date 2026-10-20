DROP INDEX "artworks_collection_public_deleted_idx";--> statement-breakpoint
CREATE INDEX "artworks_collection_status_deleted_idx" ON "artworks" USING btree ("collectionId","status","deletedAt");--> statement-breakpoint
ALTER TABLE "artworks" DROP COLUMN "isPublic";