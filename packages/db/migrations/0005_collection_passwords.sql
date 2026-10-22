CREATE TABLE "collection_access_grants" (
	"collectionId" text NOT NULL,
	"tokenHash" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	CONSTRAINT "collection_access_grants_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "collection_unlock_attempts" (
	"ip" text NOT NULL,
	"collectionId" text NOT NULL,
	"windowStart" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "collection_unlock_attempts_ip_collectionId_windowStart_pk" PRIMARY KEY("ip","collectionId","windowStart")
);
--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "passwordHash" text;--> statement-breakpoint
CREATE INDEX "collection_access_grants_collection_id_idx" ON "collection_access_grants" USING btree ("collectionId");