export const meta = {
  name: 'validate-price-cache-cutover',
  description: 'E2E validation of the unified-price-cache cutover (F7-tail/F8/F9): every BL price reader on readPriceGuide, every writer capturing via ensurePriceGuide/capturePriceGuide, legacy table renamed, deploy healthy',
  whenToUse: 'After merging + deploying the price-cache cutover PR and applying the rename migration, to independently confirm consistent use of the common functions and the unified table across prod code, scripts, DB state and the live deploy.',
  phases: [
    { title: 'Static audit', detail: 'grep-verify common-function usage + sanctioned exceptions' },
    { title: 'DB state', detail: 'rename applied, unified cache receiving writes, colour map intact' },
    { title: 'Behavioural', detail: 're-derive reader outputs from raw rows on live data' },
    { title: 'Verify', detail: 'adversarial refutation of every finding' },
    { title: 'Synthesis', detail: 'PASS/FAIL verdict' },
  ],
}

const REPO = 'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management'

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] },
          evidence: { type: 'string' },
          pass: { type: 'boolean' },
        },
        required: ['title', 'severity', 'evidence', 'pass'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
  required: ['refuted', 'reasoning'],
}

phase('Static audit')
const staticChecks = [
  {
    key: 'no-legacy-refs',
    prompt: `In repo ${REPO} (main branch, post-merge): verify ZERO live references to the legacy table bricklink_part_price_cache remain. Run: grep -rn "bricklink_part_price_cache" apps/web/src apps/web/scripts --include="*.ts". ALLOWED: (a) files whose FIRST LINE is the deprecation header "// DEPRECATED: reads bricklink_part_price_cache (dropped)..."; (b) negative test assertions in src/lib/bricklink/__tests__/live-check.service.test.ts (expect ... toBe(false)); (c) purely historical comments (price-guide-cache.service.ts header, remaining-work.md). ANY other ref — especially .from('bricklink_part_price_cache') in live code — is a critical finding. Also verify apps/web/src/lib/bricklink/part-price-cache.service.ts does NOT exist and grep finds no live import of part-price-cache.service outside deprecated-marked scripts.`,
  },
  {
    key: 'writer-consistency',
    prompt: `In repo ${REPO}: verify every BrickLink price-guide API call site either goes through the common functions or is a documented exception. Run: grep -rln "getPartPriceGuide\\|getSetPriceGuide" apps/web/src apps/web/scripts --include="*.ts". SANCTIONED src files: lib/bricklink/client.ts (definition), lib/bricklink/price-guide/capture.ts (ensurePriceGuide's own fetches), lib/bricklink/live-check.service.ts (documented partial-write lane — verify its header documents why it bypasses capturePriceGuide), lib/arbitrage/bricklink-sync.service.ts (verify its header contains "UNIFIED-PRICE-CACHE EXCEPTION"), app/api/test/bricklink-debug/route.ts (debug), the live-check test file. SANCTIONED scripts: analyze-bl-order.ts (only a GLOBAL-fallback call + non-P/M/S catalogue types — verify by reading those call sites), pg/pg-canary.ts (drift canary, must stay cache-independent), pg/pg-residual-fill.ts (worldwide pg_summary lane), plus any script whose first line carries the DEPRECATED header or whose filename starts with _ AND contains a date/probe/test marker (dead one-offs). Any OTHER file calling the raw API without capturing is a finding (severity by whether it is prod code or a script). Additionally verify these migrated files now import ensurePriceGuide or readPriceGuide: apps/web/src/lib/inventory-explorer/enrichment.service.ts, apps/web/src/lib/inventory-explorer/bricklink-lookup.ts, apps/web/src/lib/bricklink/partout.service.ts, apps/web/src/app/api/brickset/pricing/route.ts, apps/web/scripts/bl-basket.ts, apps/web/scripts/scan-bl-store.ts, apps/web/scripts/find-piece.ts, apps/web/scripts/apply-bricqer-pricing.ts.`,
  },
  {
    key: 'single-str-source',
    prompt: `In repo ${REPO}: the done-criteria demand ONE STR implementation. Verify no ad-hoc sold/stock STR maths remains in live price consumers: grep -rn "sell_through_rate" apps/web/src --include="*.ts" (allowed: generated database types for the deprecated table, store-quality/pricing.ts strRatioFromCache legacy helper + comments). Then grep for hand-rolled STR division patterns in the migrated files (enrichment.service.ts, bricklink-lookup.ts, partout.service.ts) — they must use view.strQty / view.strLots from readPriceGuide, not recompute sold/stock from raw columns. Read the three files to confirm. Report any recomputation as a major finding.`,
  },
]
const staticResults = await parallel(staticChecks.map((c) => () =>
  agent(c.prompt + ' Return findings (pass=true/false per check) with exact file:line evidence.', {
    label: `static:${c.key}`, phase: 'Static audit', schema: FINDINGS_SCHEMA,
  })
))

phase('DB state')
const dbChecks = [
  {
    key: 'rename-applied',
    prompt: `Against the live Supabase project modjoikyuhqzouxvieua (use ToolSearch to load mcp__plugin_supabase_supabase__execute_sql, read-only queries only): verify (1) table bricklink_part_price_cache does NOT exist and bricklink_part_price_cache_deprecated DOES exist (query information_schema.tables); (2) migration version 20260710000000 appears in the migration history (supabase_migrations.schema_migrations); (3) the deprecated table's row count is unchanged-ish i.e. > 10000 rows (it held tens of thousands — a near-empty table would mean data loss during rename).`,
  },
  {
    key: 'unified-cache-live',
    prompt: `Against the live Supabase project modjoikyuhqzouxvieua (read-only SQL): verify the unified cache is alive and receiving writes: (1) SELECT count(*) FROM bricklink_price_guide_cache — expect > 1000; (2) count rows with fetched_at > now() - interval '48 hours' — expect > 0 (PG lanes run daily); (3) SELECT count(*) FROM bricklink_colour_map — expect > 150; (4) sample 5 recent rows and confirm all four quadrant column families are present (uk_sold_*_new/used, uk_stock_*_new/used) with parse_version populated; (5) SELECT count(*) FROM bricklink_pg_summary_cache — expect > 50000 (world-fallback layer intact).`,
  },
]
const dbResults = await parallel(dbChecks.map((c) => () =>
  agent(c.prompt + ' Return findings with the actual numbers as evidence.', {
    label: `db:${c.key}`, phase: 'DB state', schema: FINDINGS_SCHEMA,
  })
))

phase('Behavioural')
const behavioural = [
  {
    key: 'read-view-correctness',
    prompt: `In repo ${REPO} with apps/web/.env.local loaded: write a THROWAWAY script in the scratchpad (NOT the repo) that imports readPriceGuide from apps/web/src/lib/bricklink/price-guide/read.ts, points at live Supabase, and reads 3 tuples known to exist (query bricklink_price_guide_cache for 3 part rows with uk_sold_lots_used > 0 first, via @supabase/supabase-js with the service key from apps/web/.env.local). For each: independently SELECT the raw row and hand-compute strLots (uk_sold_lots/uk_stock_lots) and strQty (uk_sold_qty/uk_stock_qty) per condition, then compare with the view's strLots/strQty. Also verify coverage==='uk' for these rows, and that a made-up tuple (item_no 'zzz-fake-999', colour 0) returns coverage 'world_fallback' or 'none', never a fabricated price. Run with npx tsx from apps/web. Exact matches required (floating tolerance 1e-9).`,
  },
  {
    key: 'explorer-backlog-derivation',
    prompt: `In repo ${REPO} with apps/web/.env.local loaded: the Inventory Explorer's "need BL enrichment" backlog is now derived from the unified cache. Write a THROWAWAY scratchpad script (npx tsx from apps/web) that replicates EnrichmentService.getUnenrichedItems logic (read apps/web/src/lib/inventory-explorer/enrichment.service.ts first): pull bricqer_inventory_snapshot rows (paginate!), consolidate by (item_number, BL colour via loadColourMap normalise with scheme 'bricqer', item_type), and count how many tuples have NO fresh (90d) UK row in bricklink_price_guide_cache. Report: total tuples, enriched count, unenriched count, and unmappable-colour count. Sanity checks: unenriched should be LOWER than the pre-cutover figure of ~11,737 IF PG-lane coverage overlaps inventory (report the delta); unmappable should be a small fraction (<5%). A wildly higher backlog than 11,737 or >20% unmappable is a major finding (colour-map join regression).`,
  },
  {
    key: 'deploy-health',
    prompt: `Verify the production deploy of the cutover is healthy. Repo ${REPO}: read docs/agents/merge-feature/last-deploy.json if present for the convention; then use "npx vercel ls hadley-bricks-inventory-management" or "npx vercel inspect" (vercel CLI is authenticated) OR check https://hadley-bricks-inventory-management.vercel.app responds 200/redirect-to-login. Confirm (1) the latest production deployment is READY and its commit is on main containing the price-cache cutover merge (git log origin/main --oneline -5 in the repo shows the merge); (2) the app root and /api/inventory/explorer/sync-status return HTTP 401/200/307 (anything but 5xx). No credentials needed — we only need non-5xx and deploy READY.`,
  },
]
const behaviouralResults = await parallel(behavioural.map((c) => () =>
  agent(c.prompt + ' Return findings with the actual numbers/outputs as evidence.', {
    label: `behave:${c.key}`, phase: 'Behavioural', schema: FINDINGS_SCHEMA,
  })
))

phase('Verify')
const allFindings = [...staticResults, ...dbResults, ...behaviouralResults]
  .filter(Boolean)
  .flatMap((r) => r.findings)
const failures = allFindings.filter((f) => !f.pass)
log(`${allFindings.length} checks, ${failures.length} failures pre-verification`)

const verified = await parallel(failures.map((f) => () =>
  agent(
    `Adversarially verify this claimed FAILURE from the unified-price-cache cutover validation. Repo ${REPO}, Supabase project modjoikyuhqzouxvieua (read-only). Claim: "${f.title}" — severity ${f.severity}. Evidence: ${f.evidence}. Re-derive the evidence yourself from the actual files/DB. Default to refuted=true unless you can INDEPENDENTLY reproduce the failure. A check that was simply too strict (e.g. flagged a sanctioned exception documented in the file's header, or a historical comment) is refuted.`,
    { label: `verify:${f.title.slice(0, 30)}`, phase: 'Verify', schema: VERDICT_SCHEMA }
  ).then((v) => ({ ...f, verdict: v }))
))

phase('Synthesis')
const confirmed = verified.filter(Boolean).filter((f) => f.verdict && !f.verdict.refuted)
const refuted = verified.filter(Boolean).filter((f) => f.verdict && f.verdict.refuted)
const criticalOrMajor = confirmed.filter((f) => f.severity === 'critical' || f.severity === 'major')

return {
  verdict: criticalOrMajor.length === 0 ? 'PASS' : 'FAIL',
  totalChecks: allFindings.length,
  passedOutright: allFindings.length - failures.length,
  confirmedFailures: confirmed,
  refutedFindings: refuted.map((f) => ({ title: f.title, why: f.verdict.reasoning })),
}
