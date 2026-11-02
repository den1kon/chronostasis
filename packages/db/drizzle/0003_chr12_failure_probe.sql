-- Deliberate, temporary acceptance failure; never release to main.
DO $$
BEGIN
  RAISE EXCEPTION 'CHR-12 expected migration failure';
END
$$;
