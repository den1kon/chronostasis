-- Make the token available before the migration transaction reopens legacy account writes.
DO $$
BEGIN
  INSERT INTO "public"."items" ("id", "name", "rarity", "sprite_x", "sprite_y")
  VALUES ('creation-token', 'Token of Creation', 'common', 4, 0)
  ON CONFLICT ("id") DO NOTHING;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P2403',
      MESSAGE = 'CHR-24 requires the creation-token catalogue ID to be unused.';
  END IF;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."chr24_legacy_welcome_provenance"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."item_id" := 'creation-token';
  NEW."acquisition_source" := 'account_creation';
  NEW."is_verified" := true;
  RETURN NEW;
END;
$$;
