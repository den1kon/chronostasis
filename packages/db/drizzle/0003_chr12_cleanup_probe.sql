-- Remove only the empty acceptance table; keep unexpected data for owner review.
DO $$
BEGIN
  LOCK TABLE "chr12_deployment_probe" IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM "chr12_deployment_probe") THEN
    RAISE EXCEPTION 'CHR-12 probe is not empty';
  END IF;
  DROP TABLE "chr12_deployment_probe";
END
$$;
