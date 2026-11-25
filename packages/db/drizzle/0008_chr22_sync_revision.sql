ALTER TABLE "users" ADD COLUMN "revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_revision_safe" CHECK ("users"."revision" between 0 and 9007199254740991);--> statement-breakpoint
UPDATE "chests" SET "price" = 0 WHERE "id" = 'basic-chest';
