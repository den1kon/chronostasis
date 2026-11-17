-- Keep legacy writes from racing the preconditions and the provenance backfill.
LOCK TABLE "focus_sessions", "user_items" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "focus_sessions") THEN
    RAISE EXCEPTION USING ERRCODE = 'P2401',
      MESSAGE = 'CHR-24 requires an empty focus_sessions table.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "user_items" WHERE "session_id" IS NOT NULL OR "item_id" <> 'red-gem'
  ) OR EXISTS (
    SELECT 1 FROM "user_items" GROUP BY "user_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P2402',
      MESSAGE = 'CHR-24 found inventory with unrecognized legacy provenance.';
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "user_items" DROP CONSTRAINT "user_items_session_id_focus_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD COLUMN "chest_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD COLUMN "origin" text DEFAULT 'online' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_items" ADD COLUMN "acquisition_source" text;
--> statement-breakpoint
ALTER TABLE "user_items" ADD COLUMN "is_verified" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "user_items"
SET "acquisition_source" = 'account_creation', "is_verified" = true
WHERE "item_id" = 'red-gem' AND "session_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "user_items" ALTER COLUMN "acquisition_source" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_chest_id_chests_id_fk" FOREIGN KEY ("chest_id") REFERENCES "public"."chests"("id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_id_user_id_unique" UNIQUE("id","user_id");
--> statement-breakpoint
ALTER TABLE "user_items" ADD CONSTRAINT "user_items_session_owner_fk" FOREIGN KEY ("session_id","user_id") REFERENCES "public"."focus_sessions"("id","user_id") ON DELETE no action ON UPDATE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "focus_sessions_one_running_online" ON "focus_sessions" USING btree ("user_id") WHERE "focus_sessions"."origin" = 'online' and "focus_sessions"."status" = 'running';
--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_origin_allowed" CHECK ("focus_sessions"."origin" in ('online', 'offline'));
--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_offline_completed" CHECK ("focus_sessions"."origin" <> 'offline' or "focus_sessions"."status" = 'completed');
--> statement-breakpoint
ALTER TABLE "user_items" ADD CONSTRAINT "user_items_acquisition_provenance" CHECK (("user_items"."acquisition_source" = 'account_creation' and "user_items"."session_id" is null and "user_items"."is_verified")
        or ("user_items"."acquisition_source" = 'session_reward' and "user_items"."session_id" is not null and "user_items"."is_verified")
        or ("user_items"."acquisition_source" = 'offline_claim' and "user_items"."session_id" is not null and not "user_items"."is_verified"));
--> statement-breakpoint
-- Match the CHR-15 account writer during migration-first deployments and rollbacks.
CREATE FUNCTION "public"."chr24_legacy_welcome_provenance"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."acquisition_source" := 'account_creation';
  NEW."is_verified" := true;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "chr24_legacy_welcome_provenance"
BEFORE INSERT ON "public"."user_items"
FOR EACH ROW WHEN (
  NEW."item_id" = 'red-gem' AND NEW."session_id" IS NULL
  AND NEW."acquisition_source" IS NULL AND NOT NEW."is_verified"
)
EXECUTE FUNCTION "public"."chr24_legacy_welcome_provenance"();
