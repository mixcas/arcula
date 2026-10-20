CREATE TABLE "collection_collaborators" (
	"collectionId" text NOT NULL,
	"userId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_collaborators_collectionId_userId_pk" PRIMARY KEY("collectionId","userId")
);
--> statement-breakpoint
CREATE TABLE "collection_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"collectionId" text NOT NULL,
	"email" text NOT NULL,
	"invitedByUserId" text NOT NULL,
	"tokenHash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"resolvedAt" timestamp with time zone,
	CONSTRAINT "collection_invitations_tokenHash_unique" UNIQUE("tokenHash"),
	CONSTRAINT "collection_invitations_status_check" CHECK ("status" in ('pending', 'accepted', 'declined', 'revoked'))
);
--> statement-breakpoint
DROP INDEX "artworks_collection_user_deleted_idx";--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "mediaNamespaceId" text;--> statement-breakpoint
-- Hand-appended backfill: every existing collection keeps the media keys it
-- already has, so its namespace is its current owner id. New collections mint
-- a fresh opaque id once the feature code lands; drizzle-kit renders schema and
-- never data, which is why this statement is here.
UPDATE "collections" SET "mediaNamespaceId" = "userId";--> statement-breakpoint
CREATE INDEX "collection_collaborators_user_id_idx" ON "collection_collaborators" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_invitations_pending_collection_email_idx" ON "collection_invitations" USING btree ("collectionId",lower("email")) WHERE "collection_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "artworks_collection_deleted_idx" ON "artworks" USING btree ("collectionId","deletedAt");