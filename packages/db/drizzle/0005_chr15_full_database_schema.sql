CREATE TABLE "user_chests" (
	"user_id" uuid NOT NULL,
	"chest_id" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_chests_user_id_chest_id_pk" PRIMARY KEY("user_id","chest_id")
);
--> statement-breakpoint
CREATE TABLE "user_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"session_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "focus_sessions" RENAME COLUMN "planned_duration" TO "planned_duration_seconds";--> statement-breakpoint
ALTER TABLE "chests" ALTER COLUMN "name" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "focus_sessions" ALTER COLUMN "ended_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "name" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "chest_items" ADD COLUMN "weight" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "chest_items" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "chest_items" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "chests" ADD COLUMN "description" jsonb;--> statement-breakpoint
ALTER TABLE "chests" ADD COLUMN "price" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chests" ALTER COLUMN "price" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "chests" ADD COLUMN "sprite_x" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chests" ALTER COLUMN "sprite_x" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "chests" ADD COLUMN "sprite_y" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chests" ALTER COLUMN "sprite_y" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "chests" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "chests" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "description" jsonb;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "rarity" text DEFAULT 'common' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "rarity" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "stats" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "sprite_x" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "sprite_x" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "sprite_y" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "sprite_y" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "coins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_chests" ADD CONSTRAINT "user_chests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "user_chests" ADD CONSTRAINT "user_chests_chest_id_chests_id_fk" FOREIGN KEY ("chest_id") REFERENCES "public"."chests"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "user_items" ADD CONSTRAINT "user_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "user_items" ADD CONSTRAINT "user_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "user_items" ADD CONSTRAINT "user_items_session_id_focus_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."focus_sessions"("id") ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "focus_sessions" DROP COLUMN "paused_at";--> statement-breakpoint
ALTER TABLE "chest_items" ADD CONSTRAINT "chest_items_weight_positive" CHECK ("chest_items"."weight" > 0);--> statement-breakpoint
ALTER TABLE "chests" ADD CONSTRAINT "chests_price_nonnegative" CHECK ("chests"."price" >= 0);--> statement-breakpoint
ALTER TABLE "chests" ADD CONSTRAINT "chests_sprite_x_nonnegative" CHECK ("chests"."sprite_x" >= 0);--> statement-breakpoint
ALTER TABLE "chests" ADD CONSTRAINT "chests_sprite_y_nonnegative" CHECK ("chests"."sprite_y" >= 0);--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_status_allowed" CHECK ("focus_sessions"."status" in ('running', 'cancelled', 'completed'));--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_duration_valid" CHECK ("focus_sessions"."planned_duration_seconds" between 900 and 10800 and "focus_sessions"."planned_duration_seconds" % 300 = 0);--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_end_matches_status" CHECK (("focus_sessions"."status" = 'running' and "focus_sessions"."ended_at" is null) or ("focus_sessions"."status" in ('cancelled', 'completed') and "focus_sessions"."ended_at" is not null));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_rarity_allowed" CHECK ("items"."rarity" in ('common', 'rare', 'epic', 'legendary', 'mythic'));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_sprite_x_nonnegative" CHECK ("items"."sprite_x" >= 0);--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_sprite_y_nonnegative" CHECK ("items"."sprite_y" >= 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_coins_nonnegative" CHECK ("users"."coins" >= 0);
