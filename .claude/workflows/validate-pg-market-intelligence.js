export const meta = {
  name: 'validate-pg-market-intelligence',
  description:
    'E2E validation v2 — BrickRadar P0-P2 + round-2 hardening (rank cut, three-gate honest projections, histogram, variant-ID recovery) — against live systems',
  whenToUse:
    'Final clean pass after the round-2 merge: schema + data integrity re-verified, rank state live (60k active), three gates proven on the gated Jabbz report, histogram primitive in code, variant-ID recovery audited, ops readiness (local-only scheduling, queue hygiene, Jabbz acceptance still holds).',
  phases: [
    { title: 'Verify', detail: 'parallel independent checks: schema+integrity, rank state, three gates, histogram+variant, ops readiness, Jabbz acceptance' },
    { title: 'Synthesize', detail: 'aggregate into PASS/CONCERN/FAIL with evidence' },
  ],
}

// args: { projectId }
const A = args || {}
const PROJECT = A.projectId || 'modjoikyuhqzouxvieua'
const REPO = 'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management'

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          pass: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['name', 'pass'],
      },
    },
    verdict: { type: 'string', enum: ['PASS', 'CONCERN', 'FAIL'] },
    summary: { type: 'string' },
  },
  required: ['dimension', 'checks', 'verdict', 'summary'],
}

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    overall: { type: 'string', enum: ['PASS', 'CONCERN', 'FAIL'] },
    headline: { type: 'string' },
    byDimension: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { dimension: { type: 'string' }, verdict: { type: 'string' } },
        required: ['dimension', 'verdict'],
      },
    },
    topIssues: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
  },
  required: ['overall', 'headline', 'byDimension', 'topIssues', 'recommendation'],
}

const COMMON = `Repo: ${REPO} (main branch is the audit target unless told otherwise). Supabase project: ${PROJECT} (use mcp supabase execute_sql via ToolSearch; READ-ONLY — never INSERT/UPDATE/DELETE/DDL). Spec: docs/features/pg-market-intelligence/spec.md v2; acceptance: docs/features/pg-market-intelligence/done-criteria.md. Report every check with expected vs actual. Be adversarial: try to REFUTE that the system works; a check passes only on positive evidence.`

phase('Verify')

const DIMENSIONS = [
  {
    key: 'schema-integrity',
    prompt: `${COMMON}
Dimension: SCHEMA + DATA INTEGRITY (re-verification).
1. Tables bricklink_pg_snapshots, bl_pg_refresh_queue, bl_pg_lane_telemetry exist with RLS; views pg_screen_high_str/fig_radar/trend_movers exist and are queryable.
2. SQL: zero bricklink_pg_summary_cache rows with currency != 'GBP' AND fx_rate IS NULL (ingest-guard invariant). no_data=true rows have all four lots columns = 0 (sample 100).
3. Provenance distribution: report counts by fetch_identity — expect brickstore_batch ~111,790 (fx 0.7407), anon_curl ~276+ (the Jabbz fill), store_api ~3, catalogpg 0-or-more.
4. Migration files for 20260707193202 / 20260708090000 / 20260708120000 tracked on origin/main.`,
  },
  {
    key: 'rank-state',
    prompt: `${COMMON}
Dimension: RANKING CUT LIVE (round 2).
1. SQL: bl_pg_refresh_queue tier counts — expect active=60,000 and tail ~52,000; ALL active rows have next_due_at within 28 days of now (the spread second pass); zero locked rows; active avg rank_score >> tail avg (report both).
2. Top-10 active by rank_score: plausible high-liquidity commons (3001, 3023, 973c000 etc.) — sanity-check scores are GBP-scale (hundreds to tens of thousands, not millions).
3. CODE AUDIT pg-rank.ts: every row in an upsert batch carries IDENTICAL columns (the mixed-payload NULL-fill bug, fixed 2026-07-08) — verify both the main batch and the newly-active second pass are uniform; refute if any conditional key remains.
4. Grace/rank_floor rows: any tuple with grace_until > now() must be tier='active' regardless of score.`,
  },
  {
    key: 'three-gates',
    prompt: `${COMMON}
Dimension: THREE-GATE HONEST PROJECTIONS (round 2). Evidence file: tmp/stores/Jabbz/pg-scan-report-gated-2026-07-08.md (compare vs pg-scan-report-retro-2026-07-08.md).
1. Gated report: identity-ambiguous count = 142, floor-unviable = 5 lots (~£84 naive net excluded), realisable net ~£274 vs raw ~£592 vs old ungated £3,142. Verify these numbers appear in the reports.
2. Part 2780 (black, Used): ABSENT from gated buy+watch lists. Independently verify from bricklink_price_guide_cache: uk_detail soldUsed.max < 0.0699 -> floor-unviable is CORRECT, not a bug.
3. CODE AUDIT bl-pg-store-scan.ts: Gate 1 groups S-lots by tuple with case-folded name comparison; Gate 2 only fires when list <= floor+epsilon and uses maxSold when src='uk', floorDepth ratio otherwise (clamp 0.05-1); Gate 3 imports captureFraction from liquidity-pov (NOT a duplicate curve) and verdict thresholds use realisable net. Refute each if wrong.
4. Adversarial: construct a scenario where a GOOD lot gets wrongly excluded (e.g. same set sold in N and U with identical names — must NOT trip Gate 1; a lot whose list is above floor must never get floor-gated). Trace the code for both.`,
  },
  {
    key: 'histogram-variant',
    prompt: `${COMMON}
Dimension: HISTOGRAM + VARIANT-ID RECOVERY (round 2). CODE AUDIT:
1. price-guide-page.ts: PgQuadrantStats.hist built in computeQuadrantStats from the same kept rows (sum(hist)===qty invariant — confirm a test asserts it and passes); 150-bucket cap rolls remainder into 'other' preserving total qty; PG_EXTRACT_JS UNCHANGED (the literal-guard tests still pass); qtyShareAtOrAbove: 'other' excluded from numerator, included in denominator (safe lower bound — confirm doc + tests).
2. price-guide-cache.service.ts: PG_PARSE_VERSION=3; uk_detail AND world_detail carry hist per side; v2 rows remain readable (no reader assumes hist).
3. bl-pg-store-scan.ts: itemSeq folded into itemNo at scrape time for S-type with seq>1 (Day N = seq N+1, seq 1 = boxed set); old cached inventory without itemSeq is safe (undefined > 1 === false); Gate 1 retained as fallback; variantRecoveredCount in report meta.
4. SQL: bricklink_pg_summary_cache has NO rows for variant IDs like '75366-13' yet — confirm recovered variants will route to gap-fill (priceSource none -> enqueue), the designed honest path. Give examples.
5. pg-residual-fill.ts: session cap now min(400,...) with the ramp procedure documented; default still 40.`,
  },
  {
    key: 'ops-readiness',
    prompt: `${COMMON}
Dimension: OPS READINESS (local-only + hygiene).
1. NO Vercel footprint: vercel.json has no pg crons; no new pg API routes under apps/web/src/app/api.
2. CI (.github/workflows/ci.yml on main) includes typecheck:scripts.
3. register-pg-tasks.ps1: 4 tasks (refresh 00:05, canary 07:30 --cdp --api, rank 09:00 day-1 guard, digest Mon 07:45), space-safe quoting. Check Get-ScheduledTask 'HadleyBricks-PG-*' — expected NOT registered yet (the deliberate final manual step); report actual state WITHOUT registering anything.
4. bl_pg_lane_telemetry: report today's rows per lane (anon_curl sessions ~9-10; store_api may be 0 — the take-1 run was killed before its end-of-run telemetry flush, which is a known accepted gap) — the telemetry pipeline demonstrably records.
5. Queue hygiene: zero rows locked_by NOT NULL older than 1h; attempts distribution (max small); zero un-resolved last_error='challenge' rows OR explain.`,
  },
  {
    key: 'p02-completion-ui',
    prompt: `${COMMON}
Dimension: P0-P2 COMPLETION + UI (wave 3, PR #526). CODE + DATA:
1. scripts/pg/pg-set-check.ts exists (L1-first set intelligence): verify it computes gross AND realisable POV (imports liquidityAdjustedPov), degrades gracefully without CDP, and the OLD _str-check-set-pg.ts is GONE. scripts/pg/pg-make-bsx.ts exists (--due-tail mode). Confirm NO _probe-pg*/_tmp PG POC scripts remain in apps/web/scripts (list any leftovers).
2. BIN watcher wiring: ebay-bin-partout-scanner.service.ts loads set-level str_used from bricklink_pg_summary_cache and only sets realisablePovGbp when a genuine STR exists (null otherwise — refute if any fabricated capture rate is possible); discord card line is additive (no suppression/threshold change — diff the alert-eligibility logic vs main~1).
3. UI: apps/web/src/app/(dashboard)/brickradar/page.tsx exists, server-component reads only (no new API routes under src/app/api for brickradar, no client polling), auth check present (getUser redirect), nav entry in Sidebar. bl_pg_scan_reports table live with RLS + authenticated SELECT (SQL check). Scanner persists via persistScanReport non-fatally.
4. Ops: pg-digest divergence reminder (NEXT_DIVERGENCE_DUE constant), pg-refresh-cycle sendPgOpsAlert on >=2 blocked sessions (fire-and-forget — alerting failure must not fail the run; verify the try/catch).
5. DATA: the hitlist set-layer fill is running/ran today — count bricklink_pg_summary_cache item_type='S' rows now vs the 242 baseline; report progress and telemetry (anon_curl sessions with session-max 80). NO action needed either way — it runs across days.`,
  },
  {
    key: 'jabbz-acceptance',
    prompt: `${COMMON}
Dimension: JABBZ ACCEPTANCE (still holds after round 2).
1. Recompute uncovered: tmp/stores/Jabbz/pg-scan-inventory-2026-07-07-prepurchase.json tuples (dedupe P:no:colour, S/M:no:0) minus bricklink_pg_summary_cache (paginate!). Expect 0.
2. The 244 fill outcomes persisted: count L1 rows fetched 2026-07-08 with fetch_identity IN ('anon_curl','store_api') — expect ~244.
3. Note (do NOT re-run anything): the NEXT live scan will surface ~142 variant-ID tuples (75366-N etc.) as new gap-fill work — designed behaviour, not a regression. Confirm the enqueueGapFill path (ignoreDuplicates) in bl-pg-store-scan.ts is intact.`,
  },
]

const results = await parallel(
  DIMENSIONS.map((d) => () =>
    agent(d.prompt, { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }),
  ),
)

phase('Synthesize')
const valid = results.filter(Boolean)
log(`${valid.length}/${DIMENSIONS.length} dimensions reported`)

const synthesis = await agent(
  `You are synthesizing the FINAL clean-pass E2E validation of the BrickRadar PG platform (P0-P2 + round-2 hardening). Dimension verdicts (JSON): ${JSON.stringify(valid)}. ` +
    `Rules: any FAIL dimension => overall FAIL. Any CONCERN => overall at best CONCERN. All PASS => PASS. ` +
    `Known-and-accepted items that must NOT drag the verdict below PASS if everything else is clean: (a) Windows tasks not yet registered (deliberate final manual step), (b) store_api telemetry row missing from the killed take-1 run, (c) zero snapshots/trend-mover rows before the first nightly refresh, (d) variant-ID tuples pending gap-fill. ` +
    `Produce overall verdict, one-line headline, per-dimension verdicts, top issues (concrete, file/table references), and a recommendation listing exactly what remains manual.`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA },
)

return { synthesis, dimensions: valid }
