CREATE TABLE "chest_items" (
	"chest_id" text NOT NULL,
	"item_id" text NOT NULL,
	CONSTRAINT "chest_items_chest_id_item_id_pk" PRIMARY KEY("chest_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "chests" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chest_items" ADD CONSTRAINT "chest_items_chest_id_chests_id_fk" FOREIGN KEY ("chest_id") REFERENCES "public"."chests"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "chest_items" ADD CONSTRAINT "chest_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE restrict;