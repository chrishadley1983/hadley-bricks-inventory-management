-- Flags POV cache rows whose listing aggregates >=2 items (CMF "Complete Series of N",
-- "Box of N", "Complete Random Set of N>=2"). For these, partout_multiple = sold / single-pack RRP
-- is an RRP-SCOPE MISMATCH (a 16-fig series sold value over a 1-bag RRP), so the multiple is inflated
-- ~Nx and is NOT comparable to single-set multiples. Single-item listings ("Complete Random Set of 1")
-- are intentionally NOT flagged — their scope matches the 1-pack RRP, so their multiple is genuine.
--
-- Single source of truth for ranking: exclude or down-rank `is_aggregate_listing` when ranking by
-- partout_multiple (the future Vinted buy/skip ranking, ad-hoc "standout multiples" queries, the
-- set-lookup card). Generated + STORED so it backfills every existing row and stays correct on upsert.

ALTER TABLE public.bricklink_part_out_value_cache
  ADD COLUMN IF NOT EXISTS is_aggregate_listing boolean
  GENERATED ALWAYS AS (
    coalesce(set_name, '') ~* '\m(Complete Series of|Box of|Complete Random Set of)\s+([2-9]|[0-9]{2,})'
  ) STORED;

COMMENT ON COLUMN public.bricklink_part_out_value_cache.is_aggregate_listing IS
  'True when the listing aggregates >=2 items (CMF "Complete Series of N", "Box of N", "Complete Random Set of N>=2"), so partout_multiple is computed against a single-pack RRP and is NOT comparable to single-set multiples. Exclude or down-rank these when ranking by partout_multiple.';
