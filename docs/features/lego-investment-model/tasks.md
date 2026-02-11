# Tasks: lego-investment-model

## Implementation Tasks (verification implicit)

- [ ] F1: Schema migration extends brickset_sets with investment columns
  - blocked_by: none
  - criterion: "Migration adds investment/retirement columns to brickset_sets, creates retirement_sources and price_snapshots tables, preserves existing data, RLS enabled"
  - verify_type: AUTO

- [ ] F2: Rebrickable API client and weekly cron sync
  - blocked_by: F1
  - criterion: "Rebrickable API client fetches sets/themes/minifigs, cron job syncs weekly, merges without overwriting Brickset fields"
  - verify_type: AUTO

- [ ] F3: Rebrickable sync populates 2,000+ current sets
  - blocked_by: F2
  - criterion: "brickset_sets contains >= 2,000 sets with set_number, name, year, theme, piece_count populated"
  - verify_type: AUTO

- [ ] F4: Retirement data aggregated from at least 2 sources
  - blocked_by: F1
  - criterion: "retirement_sources table has data from both brickset and bricktap sources with confidence levels"
  - verify_type: AUTO

- [ ] F5: Retirement status rollup calculated per set
  - blocked_by: F4
  - criterion: "brickset_sets.retirement_status derived from sources (available/retiring_soon/retired) with confidence (confirmed/likely/speculative)"
  - verify_type: AUTO

- [ ] F6: Investment dashboard page at /investment
  - blocked_by: F3, F5
  - criterion: "DataTable at /investment with columns (set number, name, theme, RRP, retirement status, date, pieces, minifigs), filters, and sidebar nav"
  - verify_type: AUTO

- [ ] E1: Rebrickable API failure is non-destructive
  - blocked_by: F2
  - criterion: "API failure logs error, sends Discord alert, exits without modifying existing data"
  - verify_type: AUTO

- [ ] E2: Individual retirement source failure doesn't block others
  - blocked_by: F4
  - criterion: "One source failing still allows other sources to process; response reports per-source success/failure"
  - verify_type: AUTO

- [ ] I1: Migration preserves all existing brickset_sets data
  - blocked_by: F1
  - criterion: "ALTER TABLE only, no DROP/RECREATE, existing rows unchanged, new columns default NULL"
  - verify_type: AUTO

- [ ] P1: Full Rebrickable sync completes within Vercel function timeout
  - blocked_by: F3
  - criterion: "Full sync of 2,000+ sets completes in < 300 seconds with batch processing"
  - verify_type: AUTO
