# PG Market Intelligence — Done Criteria (P0–P2 build)

Derived from spec.md Draft v2 (§3, §4, §6). Each criterion is independently verifiable;
the E2E validation workflow checks these against live systems after merge + deploy.

## F1 — Schema (migration)

- [ ] `bricklink_pg_snapshots` exists: L1 row shape + `snapshot_date`, PK (item_type, item_no, colour_id, snapshot_date), RLS enabled.
- [ ] `bl_pg_refresh_queue` exists: tuple PK, `rank_score`, `tier` ('active' | 'tail'), `grace_until` (new-release rule), `last_refreshed_at`, `next_due_at`, `locked_by`, `attempts`, `last_error`, RLS enabled.
- [ ] `bl_pg_lane_telemetry` exists: per-night per-lane rows — requests, ok/fail counts, first-403 position, session count.
- [ ] `bricklink_pg_summary_cache` gains `fetch_identity` (lane class) and `fx_rate` (nullable; non-null ⇒ converted row). Existing rows backfilled with a sensible identity from `source`.
- [ ] Migration pushed via `npm run db:push` with history intact (no execute_sql DDL).

## F2 — Coverage core (`apps/web/scripts/pg/`)

- [ ] `pg-universe.ts`: downloads lane E catalog files (parts, minifigs, colours, part+colour codes, sets), diffs against known universe, inserts new tuples into refresh queue with `grace_until = now() + 6 months`. Idempotent.
- [ ] `pg-harvest-import.ts`: ingests BrickStore BSX harvest files into L1 with **ingest-time currency validation** (reject/quarantine non-GBP-basis rows unless fx stamped) and provenance columns set. Replaces the POC import path.
- [ ] `pg-residual-fill.ts`: queue-driven and **resumable** (works `bl_pg_refresh_queue` rows, not a one-shot list); sessions of ≤40 requests with breathers; on challenge (3 consecutive fails) rotates the tuple to lane A (BL API country-less summary equivalent) instead of aborting the run; writes telemetry. **Acceptance: clears the 244 open Jabbz tuples without manual restarts.**
- [ ] Set `-1` suffix + alias part-number resolution live in shared code (`apps/web/src/lib/bricklink/`), unit-tested, used by both fill and refresh paths.

## F3 — Refresh engine

- [ ] **All scheduling is LOCAL** (hard constraint from Chris, 2026-07-08): the nightly driver and every recurring pg job run on the local bot (tsx scripts invoked by Windows scheduled tasks, or localhost:3000 routes on the NSSM service — same pattern as the ebay-pricing local migration). **No Vercel crons, no vercel.json entries, no new Vercel API-route workloads** — Fluid CPU headroom is not available (see vercel-fluid-cpu-reduction memory).
- [ ] `pg-refresh-cycle.ts`: nightly driver — claims due active-cycle tuples, drives lane D (PgScraper) in sessions of 350 with 20-min breathers, 403 → 30-min backoff then resume, writes L3 + write-through, snapshots to `bricklink_pg_snapshots`, telemetry row per session.
- [ ] `pg-rank.ts` (or SQL job): recomputes ranking cut monthly — top ~60k by 6-mo sold value, floors for watchlist/own-inventory tuples, grace-listed new releases always included; assigns `tier` in queue.
- [ ] Canary: ~20 golden tuples fetched via each active lane daily; >5% cross-lane divergence → Discord alert.
- [ ] All loops flush ≤50 rows and are resumable via cache/queue state.

## F4 — Live check + POV join

- [ ] `live-check` module in lib: given tuple(s), fetch official UK price guide via BL store API (`country_code=UK`, ~2 calls/tuple), write through to L3 (`bricklink_price_guide_cache`) + `bricklink_part_price_cache`, respecting the daily API budget tracker.
- [ ] Store-scan scorer joins L4 POV (`bricklink_part_out_value_cache`) for set rows.

## F5 — Intelligence

- [ ] High-STR screen + fig radar exist as SQL views over L1/L3 with a runner script producing a markdown report.
- [ ] Own-store audit script: joins live store inventory vs L1/L3 → overpriced-vs-velocity, underpriced-vs-UK, dead-stock lists.
- [ ] Weekly digest generator: markdown output combining screens + audit + coverage/freshness health + lane telemetry; delivery via existing Discord/email path.
- [ ] Liquidity-adjusted POV: `realisable_pov = Σ qty × price × f(STR)` with capture curve constants derived from our sales history; exposed for set reports.

## F6 — Quality gates

- [ ] Unit tests for: ranking cut, session/breather planner, ingest currency validation, alias/`-1` resolution, capture curve, queue claim/backoff logic.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all green.

## Out of scope for this build

- P1's "30 unattended days" exit criterion (runs after merge; telemetry proves it over time).
- P3 multi-tenant productisation (separate architectural review per spec §6).
- Windows scheduled-task registration (manual step, documented in the runbook section of the report).
