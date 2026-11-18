DROP TABLE "email_tokens" CASCADE;--> statement-breakpoint
DROP TABLE "rate_limits" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "email_verified_at";--> statement-breakpoint
DROP TYPE "public"."email_token_purpose";