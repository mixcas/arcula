CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"providerId" text NOT NULL,
	"accountId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artwork_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"artworkId" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"contentType" text NOT NULL,
	"width" integer,
	"height" integer,
	CONSTRAINT "artwork_documents_kind_check" CHECK ("kind" in ('file', 'image'))
);
--> statement-breakpoint
CREATE TABLE "artwork_photo_variants" (
	"parentKind" text NOT NULL,
	"parentId" text NOT NULL,
	"key" text NOT NULL,
	"width" integer,
	"height" integer,
	"size" integer,
	"contentType" text,
	CONSTRAINT "artwork_photo_variants_parentId_key_pk" PRIMARY KEY("parentId","key"),
	CONSTRAINT "artwork_photo_variants_parent_kind_check" CHECK ("parentKind" in ('photo', 'document'))
);
--> statement-breakpoint
CREATE TABLE "artwork_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"artworkId" text NOT NULL,
	"order" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artworks" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"collectionId" text NOT NULL,
	"title" text NOT NULL,
	"artistName" text NOT NULL,
	"serie" text,
	"dateOfCreation" text,
	"media" text,
	"dimensions" text,
	"editions" text,
	"acquisitionDate" text,
	"acquisitionPrice" text,
	"placeOfOrigin" text,
	"provenance" text,
	"notes" text,
	"condition" text,
	"currentValue" text,
	"isPublic" boolean DEFAULT true NOT NULL,
	"deletedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"skin" text,
	"skinOptions" jsonb,
	"isPublic" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"token" text NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"firstName" text,
	"lastName" text,
	"tier" text DEFAULT 'free' NOT NULL,
	"settings" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artwork_documents_artwork_id_idx" ON "artwork_documents" USING btree ("artworkId");--> statement-breakpoint
CREATE UNIQUE INDEX "artwork_photos_artwork_id_order_key" ON "artwork_photos" USING btree ("artworkId","order");--> statement-breakpoint
CREATE INDEX "artworks_collection_user_deleted_idx" ON "artworks" USING btree ("collectionId","userId","deletedAt");--> statement-breakpoint
CREATE INDEX "artworks_collection_public_deleted_idx" ON "artworks" USING btree ("collectionId","isPublic","deletedAt");--> statement-breakpoint
CREATE INDEX "artworks_collection_id_idx" ON "artworks" USING btree ("collectionId");--> statement-breakpoint
CREATE INDEX "collections_user_id_idx" ON "collections" USING btree ("userId");