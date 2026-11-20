CREATE TABLE "notify_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"telegram_chat_id" text,
	"telegram_name" text,
	"link_code_hash" text,
	"link_code_expires_at" timestamp with time zone,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notify_settings_link_code_hash_unique" UNIQUE("link_code_hash")
);
--> statement-breakpoint
DROP INDEX "items_user_sku_uq";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "source_name" text;--> statement-breakpoint
ALTER TABLE "notify_settings" ADD CONSTRAINT "notify_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "items_user_sku_uq" ON "items" USING btree ("user_id","sku") WHERE deleted_at is null;