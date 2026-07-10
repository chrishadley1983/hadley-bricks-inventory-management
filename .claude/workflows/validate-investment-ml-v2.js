export const meta = {
  name: 'validate-investment-ml-v2',
  description:
    'E2E validation of PR #500 — investment ML v2 (Keepa triple-parse fix, median-window labels, temporal-split ridge/NN training, keepa-refresh feed) — against live systems',
  whenToUse:
    'After merging + deploying PR #500 and running the prod recalc+retrain+rescore, to independently confirm the corrupt snapshots are gone (and backed up), the re-import writes clean v2 rows, labels are median_window_v2 with corroboration, the artifact is v2 with honest temporal-holdout metrics, predictions are within bounds with derived confidence, and the keepa-refresh feed will keep running daily.',
  phases: [
    { title: 'Validate', detail: 'one read-only validator per dimension (git/prod + Supabase + Windows task + code review)' },
    { title: 'Verify', detail: 'adversarially re-check any FAIL/WARN finding' },
    { title: 'Synthesize', detail: 'PASS/FAIL E2E report' },
  ],
};

const CTX = `
CONTEXT — you are validating, on LIVE systems, PR #500 "investment ML v2" (branch feature/investment-ml-v2, squash-merged to origin/main).

WHY THE CHANGE: the v1 investment model was unusable (holdout R² 0.19, MAE ~8,565pp). Root cause: Keepa's BUY_BOX history CSV is TRIPLE-encoded [timestamp, price, shipping] but keepa-client extractSnapshots parsed it as PAIRS, corrupting ~1,043,137 of 1,252,729 price_snapshots rows (source='keepa_amazon_buybox'): Keepa timestamps became "£70k prices" and shipping pence became "~2011 dates". Those rows became training labels via a closest-single-snapshot lookup (max label 999,999.99% on set 5610-1, RRP £2.45). Additional methodology defects: random train/holdout split, theme-average feature computed over ALL data incl. the holdout and each sample's own label (leakage), 3yr labels silently backfilled with 1yr values, null sales rank imputed as 0 (best rank), hardcoded confidence 0.7, and the Keepa feed dead since 2026-02-09 (the Feb import was a one-off backfill; GCP investment jobs are PAUSED — the LOCAL Peter-bot scheduler in Discord-Messenger/jobs/hb_crons.py drives investment-sync daily 07:00 UTC and investment-retrain monthly 1st 05:00 UTC against http://localhost:3000).

THE CHANGE (all in apps/web unless noted):
(A) keepa-client.ts: NEW parseKeepaBuyBoxCSV (triples, landed price = price + max(shipping,0)); extractSnapshots uses it for BUY_BOX; recent (<=180d) rank-only dates become price-null rows so demand data stays fresh.
(B) keepa-import.service.ts: rows tagged raw_data.parser_version='v2'; new deleteBeforeUpsert option (purges a set's keepa rows only after Keepa returns fresh data).
(C) historical-appreciation.service.ts: labels = MEDIAN of junk-filtered (0.05x–15x RRP band) snapshots per window (at-retirement ±30d, 1yr ±45d, 3yr ±60d), >=3 corroborating points required, label_method='median_window_v2', snapshots_* counts + retired_date_estimated (true when exit_date missing) stored. Migration 20260702000001_investment_ml_v2 added those columns + the keepa_refresh_candidates view.
(D) ml/: winsorized (−95..+400%) log price-ratio target; TEMPORAL 80/20 split by retired_date; leave-one-out training-fold-only theme priors; theme one-hot top-20; sales-rank missing indicator + median imputation; per-horizon models (3yr trains only on real 3yr labels); closed-form ridge (ml/ridge.ts) vs small NN, winner by holdout MAE, benchmarked vs theme-average baseline; metrics = mae_pct / r_squared / spearman / baseline_mae_pct / beats_baseline / n_train / n_holdout + temporal_cutoff_date; artifact_version=2 stored in the investment_historical sentinel row set_num='__model_artifact__' (raw_data). Artifacts that are not v2 are IGNORED by scoring (rule-based fallback until first v2 retrain).
(E) scoring.service.ts: per-horizon inference, predictions clamped to the winsorization band with risk flag 'prediction_at_model_bound'; confidence DERIVED (base 0.25 + 0.45×spearman_1yr(clamped 0..1) + 0.1 if beats_baseline, −0.1 missing sales rank, −0.1 unseen theme; clamped 0.1..0.9) — NOT hardcoded 0.7; model_version starts 'v2-'.
(F) NEW /api/cron/keepa-refresh: stalest-first candidates from keepa_refresh_candidates view, ?limit (10..1000, default 200) and ?time_budget_ms (30s..30min, default 200s) guards; jobExecutionService name 'keepa-refresh'. Scheduled LOCALLY via Windows task "HadleyBricks-Keepa-Refresh-Local" daily 05:30 running scripts/run-keepa-refresh.ps1 (limit=500, 25-min budget, localhost:3000) — zero Vercel CPU.
(G) OPS ALREADY APPLIED (not in the PR): backup table price_snapshots_keepa_backup_20260702 (1,252,729 rows) created; the ~1.04M corrupt rows (raw_data->>'buy_box_price' IS NOT NULL without parser_version v2) DELETED from price_snapshots; full re-import running via apps/web/scripts/_keepa-reimport-v2.ts (resumable, progress in apps/web/scripts/.keepa-reimport-v2-progress.json, log apps/web/scripts/keepa-reimport-v2.log).

TIMING CAVEATS (honest-validation rules):
- The re-import may STILL BE RUNNING when you validate — coverage (distinct sets with parser_version='v2' rows) grows over hours. Judge cleanliness of what EXISTS, not completeness, unless the progress file says finished.
- Labels/artifact/predictions only flip to v2 after a recalc+retrain+rescore has run (manual trigger or the monthly investment-retrain via the local bot). If investment_historical still shows old label_method NULL rows or the artifact is v1, report that dimension as FAIL only if a v2 retrain WAS claimed to have run; otherwise WARN "retrain not yet run".
- The LOCAL server (localhost:3000, NSSM 'HadleyBricks' service) serves a PRE-BUILT bundle: new code reaches it only after apps/web rebuild + service restart. A keepa-refresh 404 on localhost = stale local bundle (WARN with that exact diagnosis), not a code bug.

ENVIRONMENT:
- Prod Supabase project_id = modjoikyuhqzouxvieua. Load SQL via ToolSearch "select:mcp__plugin_supabase_supabase__execute_sql". Key tables: price_snapshots (set_num,date,source,price_gbp,sales_rank,raw_data), price_snapshots_keepa_backup_20260702, investment_historical (set_num,retired_date,retired_date_estimated,rrp_gbp,actual_1yr_appreciation,actual_3yr_appreciation,snapshots_1yr,snapshots_3yr,label_method,data_quality,raw_data), investment_predictions (set_num,investment_score,predicted_1yr_appreciation,confidence,risk_factors,model_version,scored_at), job_execution_history (job_name,trigger,status,started_at), brickset_sets, keepa_refresh_candidates (view).
- Repo: git fetch origin; read code from origin/main. Prod URL: https://hadley-bricks-inventory-management.vercel.app
- Windows task: powershell.exe -NoProfile -Command "schtasks /query /tn 'HadleyBricks-Keepa-Refresh-Local' /fo LIST /v"
- Local server: http://localhost:3000 (POST-only, CRON_SECRET-gated routes).

RULES: Be INDEPENDENT and ADVERSARIAL — re-derive every number, do not trust this context block. READ-ONLY: no DB mutations, no schtasks changes, do NOT trigger a retrain/rescore/import, do NOT POST any cron route with a valid secret (liveness = curl expecting 401/405). Report concrete evidence (counts, SQL results, http codes, exact strings).`;

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'verdict', 'summary', 'evidence', 'issues'],
  properties: {
    dimension: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
    summary: { type: 'string', description: 'one-line conclusion' },
    evidence: { type: 'string', description: 'concrete counts / SQL results / http codes proving it' },
    issues: {
      type: 'array',
      description: 'genuine problems found (empty if PASS)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'problem'],
        properties: { item: { type: 'string' }, problem: { type: 'string' } },
      },
    },
  },
};

const DIMENSIONS = [
  {
    key: 'merge-deploy-live',
    prompt: `Confirm PR #500 merged + deployed with no regression. (1) git fetch origin; origin/main contains apps/web/src/lib/investment/ml/ridge.ts, ml/metrics.ts, api/cron/keepa-refresh/route.ts, scripts/run-keepa-refresh.ps1 and migration supabase/migrations/20260702000001_investment_ml_v2.sql (git show origin/main:<path> succeeds for each). (2) Prod healthy: curl -s -o /dev/null -w "%{http_code}" https://hadley-bricks-inventory-management.vercel.app/ (200/307 OK) and /investment (200/307). (3) NEW route live on prod: /api/cron/keepa-refresh returns 401 or 405 without a secret (404 = not deployed = FAIL; 500 = FAIL). (4) Existing cron routes NOT regressed: /api/cron/investment-sync and /api/cron/investment-retrain still 401/405. Verdict FAIL if any file missing from origin/main or any route 404/500s.`,
  },
  {
    key: 'parser-and-import-correctness',
    prompt: `Adversarially code-review the parser fix on origin/main. Read apps/web/src/lib/keepa/keepa-client.ts: (1) parseKeepaBuyBoxCSV steps i+=3 over [timestamp, price, shipping], skips price<0, value = price + max(shipping,0). (2) extractSnapshots uses parseKeepaBuyBoxCSV for KEEPA_CSV_INDEX.BUY_BOX (18) and the PAIR parser for AMAZON/SALES_RANK/COUNT_NEW; rank-only dates older than ~180d are dropped, recent ones become rows with null price. (3) keepa-import.service.ts tags raw_data.parser_version='v2' and deleteBeforeUpsert deletes ONLY after Keepa returned data for that set (inside processProduct, after the snapshots.length===0 early return — a delete on a Keepa miss would destroy good data = FAIL). Then verify against LIVE DATA with SQL: sample 50 recent v2 rows (raw_data->>'parser_version'='v2'): every price_gbp must be plausible (<= £5,000), no cluster of dates in 2011, and join a few against brickset_sets.uk_retail_price to confirm prices are within ~0.05x–20x RRP. Verdict FAIL on any parser logic defect or if v2 rows show timestamp-magnitude prices or a 2011 date cluster.`,
  },
  {
    key: 'data-cleanliness-and-backup',
    prompt: `Verify the corrupt-data purge with SQL, adversarially. (1) BACKUP: price_snapshots_keepa_backup_20260702 exists with EXACTLY 1,252,729 rows. (2) PURGE COMPLETE: zero remaining pre-v2 buybox rows — SELECT count(*) FROM price_snapshots WHERE source='keepa_amazon_buybox' AND raw_data->>'buy_box_price' IS NOT NULL AND (raw_data->>'parser_version') IS DISTINCT FROM 'v2' — must be 0. (3) NO RESIDUAL JUNK: count rows with price_gbp > 10000 for that source (expect 0; a handful of genuine £2k+ collectible prices is fine, five-figure prices are not). (4) RE-IMPORT PROGRESSING: report count of distinct set_num with parser_version='v2' rows and max(date) (should be ~today); read apps/web/scripts/.keepa-reimport-v2-progress.json if present and report done/failed counts. Coverage still growing = note it, not a FAIL. (5) The 209,592 legacy amazon-only rows (buy_box_price null, amazon_price not null) were correct and may legitimately remain for sets not yet re-imported. Verdict FAIL if backup missing/short, pre-v2 buybox rows remain, or v2 data contains five-figure prices.`,
  },
  {
    key: 'labels-v2-quality',
    prompt: `Validate the recomputed labels with SQL (this dimension assumes the recalc has run — if ALL rows still have label_method NULL, verdict WARN "recalc not yet run" and stop). For rows WHERE label_method='median_window_v2' AND data_quality IN ('good','partial'): (1) NO INSANE LABELS: max(actual_1yr_appreciation) <= 5000 hard cap — the old data had 999,999.99; anything near that = FAIL. Report the min/median/max/count. (2) CORROBORATION HONOURED: zero rows where actual_1yr_appreciation IS NOT NULL AND coalesce(snapshots_1yr,0) < 3; same for 3yr. (3) PROVENANCE: rows exist with retired_date_estimated=true (expected for expected_retirement_date fallbacks); spot-check 5 rows with exit_date set in brickset_sets have retired_date_estimated=false. (4) NO 3YR FALLBACK GHOSTS: count rows where actual_3yr_appreciation = actual_1yr_appreciation AND actual_3yr_appreciation IS NOT NULL — a few coincidences fine, hundreds = the old fallback survived = FAIL. (5) Report the trainable sample count (label_method v2, quality good/partial, 1yr label not null) vs the old 2,037. Verdict FAIL on insane labels, corroboration violations, or fallback ghosts.`,
  },
  {
    key: 'artifact-v2-honesty',
    prompt: `Validate the model artifact with SQL (if raw_data->>'artifact_version' is not '2', verdict WARN "v2 retrain not yet run" — unless a v2 retrain was already claimed, then FAIL). SELECT raw_data FROM investment_historical WHERE set_num='__model_artifact__'. Check: (1) artifact_version=2, model_version starts 'v2-'. (2) metrics.horizon_1yr present with ALL of: model_type in (ridge,nn), mae_pct, r_squared, spearman, baseline_mae_pct, beats_baseline, n_train>0, n_holdout>0; temporal_cutoff_date is a plausible date (2023–2026, NOT alphabetically-first). (3) norm_context has version=2, theme_onehot (<=20 themes), theme_target_encoding, sales_rank_median>0, feature_names length = 13 + len(theme_onehot). (4) models['1yr'] present (ridge weights length = feature_names+1, or nn topology+weights). (5) HONESTY SANITY: mae_pct should be double-digit pp (10–120), NOT thousands (old corrupt-label symptom) and NOT suspiciously ~0 (leakage symptom); spearman in [-1,1]. Report all metric values verbatim — they are the user's go/no-go numbers. Verdict FAIL on missing fields, an impossible metric, or metrics that indicate the old pathology.`,
  },
  {
    key: 'predictions-sane',
    prompt: `Validate live predictions with SQL (if max(scored_at) predates the v2 merge or all model_version are NOT 'v2-*', verdict WARN "rescore not yet run"). Over investment_predictions WHERE model_version LIKE 'v2-%': (1) BOUNDS: min(predicted_1yr_appreciation) >= -95 and max <= 400 (same for 3yr where not null) — the old table had +11,803%. (2) CONFIDENCE DERIVED: count(DISTINCT confidence) >= 3 and no confidence = 0.7 exactly dominating (>90% identical values = still hardcoded = FAIL); all in [0.1, 0.9]. (3) DISTRIBUTION: report count, avg/min/max investment_score (must span, not all identical), median predicted_1yr. (4) RISK FLAGS: rows at the ±bounds carry 'prediction_at_model_bound' in risk_factors. (5) Cross-check 3 top-scored sets by hand: their predicted_1yr_price_gbp = uk_retail_price × (1+pred/100) within rounding. Verdict FAIL on out-of-bounds predictions, constant confidence, or broken price math.`,
  },
  {
    key: 'keepa-refresh-feed-liveness',
    prompt: `Confirm the ongoing feed will actually run. (1) Windows task: schtasks query for 'HadleyBricks-Keepa-Refresh-Local' — exists, enabled/Ready, Daily, Start Time 05:30, Task To Run contains run-keepa-refresh.ps1. (2) Code: read scripts/run-keepa-refresh.ps1 on origin/main — targets http://localhost:3000/api/cron/keepa-refresh (NOT vercel.app), passes limit=500&time_budget_ms=1500000, Bearer CRON_SECRET from apps/web/.env.local, TimeoutSec >= 1800, exits non-zero on error. (3) View: SELECT count(*) FROM keepa_refresh_candidates and confirm ordering data exists (some last_keepa_date values are recent, nulls allowed). (4) LOCAL BUNDLE CAVEAT: curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/cron/keepa-refresh — 401/405 = live locally; 404 = local NSSM bundle not yet rebuilt (WARN with exactly that remediation: rebuild apps/web + restart HadleyBricks service — the 05:30 task will 404 until then). (5) job_execution_history: report any 'keepa-refresh' runs and their status. Verdict FAIL if the task is missing/disabled, the runner targets vercel.app, or the view is missing.`,
  },
];

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'final_verdict', 'reasoning'],
  properties: {
    dimension: { type: 'string' },
    final_verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
    reasoning: { type: 'string' },
  },
};

phase('Validate');
const findings = await parallel(
  DIMENSIONS.map((d) => () =>
    agent(`${CTX}\n\nYOUR DIMENSION: ${d.key}\n\n${d.prompt}\n\nReturn your finding as structured output.`, {
      label: `validate:${d.key}`,
      phase: 'Validate',
      schema: FINDING_SCHEMA,
    })
  )
);

const real = findings.filter(Boolean);
const problems = real.filter((f) => f.verdict !== 'PASS');
log(`${real.length}/${DIMENSIONS.length} validators returned; ${problems.length} non-PASS`);

let verified = [];
if (problems.length > 0) {
  phase('Verify');
  verified = (
    await parallel(
      problems.map((f) => () =>
        agent(
          `${CTX}\n\nA validator reported this ${f.verdict} finding on dimension "${f.dimension}":\nSummary: ${f.summary}\nEvidence: ${f.evidence}\nIssues: ${JSON.stringify(f.issues)}\n\nAdversarially RE-CHECK it yourself (read-only). Was the validator right, or did it misread timing caveats (re-import still running / retrain not yet triggered / stale local bundle)? Downgrade to WARN when a documented timing caveat fully explains it; uphold FAIL only for genuine defects. Return structured output.`,
          { label: `verify:${f.dimension}`, phase: 'Verify', schema: VERDICT_SCHEMA }
        )
      )
    )
  ).filter(Boolean);
}

phase('Synthesize');
const report = await agent(
  `${CTX}\n\nSynthesize the E2E validation report for PR #500 investment ML v2.\n\nPrimary findings:\n${JSON.stringify(real, null, 2)}\n\nAdversarial re-checks of non-PASS findings:\n${JSON.stringify(verified, null, 2)}\n\nProduce a markdown report: overall PASS / PASS-WITH-WARNINGS / FAIL, a one-line verdict per dimension with its strongest single piece of evidence, the artifact's headline metrics verbatim (mae_pct, spearman, baseline_mae_pct, beats_baseline, n_train/n_holdout, temporal_cutoff_date) since those are the user's go/no-go numbers for using the model in buying decisions, every unresolved issue with a concrete remediation, and any timing caveats still open (re-import completion %, retrain pending, local bundle rebuild pending). Be blunt.`,
  { label: 'synthesize', phase: 'Synthesize' }
);

return report;
