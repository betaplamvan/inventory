CREATE TYPE "public"."domain" AS ENUM('electronics', 'wardrobe', 'pantry');--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'top';--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'bottom';--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'dress';--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'outerwear';--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'shoes';--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'accessory';--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'produce';--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'protein';--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'dairy';--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'grain';--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'spice';--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'drink';--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'snack';--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'cooked';--> statement-breakpoint
CREATE TABLE "shopping_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" "domain" NOT NULL,
	"name" text NOT NULL,
	"quantity" numeric(14, 3),
	"unit" text,
	"note" text,
	"item_id" integer,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "categories_user_idx";--> statement-breakpoint
DROP INDEX "items_user_idx";--> statement-breakpoint
DROP INDEX "locations_user_idx";--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "domain" "domain" DEFAULT 'electronics' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "domain" "domain" DEFAULT 'electronics' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "domain" "domain" DEFAULT 'electronics' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "expires_at" date;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "domain" "domain" DEFAULT 'electronics' NOT NULL;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shopping_items_user_idx" ON "shopping_items" USING btree ("user_id","domain");--> statement-breakpoint
CREATE INDEX "categories_user_idx" ON "categories" USING btree ("user_id","domain");--> statement-breakpoint
CREATE INDEX "items_user_idx" ON "items" USING btree ("user_id","domain");--> statement-breakpoint
CREATE INDEX "locations_user_idx" ON "locations" USING btree ("user_id","domain");