export const meta = {
  name: 'validate-ebay-bin-partout',
  description:
    'E2E validation of the eBay BIN part-out watcher (hit list from POV cache, 15-min local scans, flag-don\'t-suppress confidence, explicit Discord cards) — against live systems',
  whenToUse:
    'After merging + deploying the BIN part-out watcher, to independently confirm the hit list is correct vs the POV cache, the local task drives the localhost route on cadence, the scanner\'s rejector/flag logic matches the discovery findings, alerts carry listing_type/flags, and the Discord cards meet the explicitness contract.',
  phases: [
    { title: 'Validate', detail: 'one read-only validator per dimension (git/prod + Supabase + Windows task + local route/log + code review)' },
    { title: 'Verify', detail: 'adversarially re-check any FAIL/WARN finding' },
    { title: 'Synthesize', detail: 'PASS/FAIL E2E report' },
  ],
};

const CTX = `
CONTEXT — you are validating, on LIVE systems, the eBay BIN PART-OUT WATCHER (feature/ebay-bin-partout, 2026-07-02).

WHAT IT IS: the business's edge is a private pricing layer — the 21k-row bricklink_part_out_value_cache (BL used/new part-out values per set). The watcher runs TWO newly-listed FIXED-PRICE passes per cycle:
- USED pass: hit list of EVERY set with usable used-POV data (~12,600 sets; used POV capped at the New part-out — the 77254 single-sale-noise guard); alert when all-in price under usedPOV/3 (good) or /4 (great). Per Chris (PR #488): NO ratio floor, NO £40 floor, NO year exclusion (config min_ratio=0, min_used_pov_gbp=0); young sets flagged '⚠️ <set> is a <year> set — thin used-parts history' at alert time.
- NEW pass (sealed; added same day): judged on TWO exits — Amazon resale margin from the LOCAL seeded_asin_pricing table (5,338 rows, "NNNNN-1" keys; margin model = 18.36% fees + £3/£4 banded shipping, same as the Vinted sniper; bars amazon_min_margin_pct=20 good / amazon_great_margin_pct=25 great, tuned from 15 after a bootstrap scan found 10% of sealed listings over the 15% bar) OR New POV >= 3x/4x cost. Own cursor column last_scan_cursor_new; new_scan_enabled config toggle; NO Keepa and NO BrickLink calls in the loop. Young-set flag deliberately does NOT apply to the NEW pass (new-sale data is deep even for young sets).
Both passes: saturation-aware pagination (a full 200-page entirely newer than the cursor fetches the next page, up to 3, logged in saturatedPages — no silent truncation); undated items processed only on bootstrap (cursor null). Flag-don't-suppress: parts/fig listings masquerading as sets (discovery: a £2.76 sword blade at "70x", a £10.80 minifig with eBay-AI-generated set description and auto-filled aspects) are ALERTED WITH FLAGS, never silently dropped — the human sifts. Durability: the route saves each alert row with discord_sent=false BEFORE attempting Discord, then updates to true on success (the cursor has already advanced, so a throw must not lose the row). First live proof: 42083 Bugatti Chiron used-pass alert at 3.17x (£86.84 vs £274.92 POV, ratio_to_rrp 0.86 — invisible under the old 2x-RRP list).

COMPONENTS (all should be at origin/main):
- Migration 20260702121815_ebay_bin_partout.sql: ebay_bin_hitlist (used_pov_gbp capped at New; learned cols ebay_floor_gbp/fig_share_pct survive refresh), ebay_bin_config (single row, min_multiple 3/great 4/min_ratio 2/min_used_pov 40/price_floor_pct 15/quiet 23-7/hitlist_max_age 24h/last_scan_cursor), ebay_auction_alerts + listing_type('bin')/flags/offer_suggestion_gbp/ratio_to_rrp, refresh_ebay_bin_hitlist(p_min_ratio,p_min_pov) SECURITY DEFINER fn.
- apps/web/src/lib/ebay-auctions/ebay-bin-partout-scanner.service.ts: one broad Browse search/cycle (q=lego, cat 19006, USED+FIXED_PRICE+GB, sort=newlyListed, limit 200, creation-time cursor in config), title regex -> hit-list match (standalone token), buy bar, getItem for candidates only, flags: Type aspect (!=Complete/absent), pieces-vs-brickset lie detector (±2% tolerance), LEGO Character + price<15% POV = probable fig listing, title/description caveat patterns, new-seller<10; eBay-floor learning from plausible complete listings (>=25% POV, no caveats); best-offer suggestion = POV/3 - postage; price-drop re-alert at >=15% cheaper.
- Route /api/cron/ebay-bin-partout (CRON_SECRET; job_execution_history job_name='ebay-bin-partout'; quiet hours inside scanner; hit list self-refreshes when older than 24h).
- scripts/run-ebay-bin-partout.ps1 + register-ebay-bin-partout-task.ps1 (every 15 min, S4U-with-interactive-fallback, log logs/ebay-bin-partout-local.log, retry-append + .dropped sidecar).
- Discord explicitness contract (goal requirement): EVERY Vinted/eBay card must answer WHAT is the play / WHERE is the value / WHAT to do, at the top. discord.service.ts: sendEbayBinPartoutAlert ("▶️ The play" + "👉 Do" + "⚠️ Check before buying" flags field) AND sendEbayAuctionAlert overhauled (play/do fields, title carries AUCTION ends Xm + PART-OUT/RESALE). extensions/vinted-sniper/content.js sendToDiscord gained the same play/do head (manifest 1.3).

ENVIRONMENT:
- Prod Supabase project_id = modjoikyuhqzouxvieua (ToolSearch "select:mcp__plugin_supabase_supabase__execute_sql").
- Windows task via: powershell.exe -NoProfile -Command "schtasks /query /tn 'HadleyBricks-Ebay-Bin-Partout-Local' /fo LIST /v"
- Run log: logs/ebay-bin-partout-local.log, one line/run: "ok seen=N new=N matches=N candidates=N alerts=N apiCalls=N hitlist=N ms=N" or "skipped reason=...".
- job_execution_history job_name='ebay-bin-partout' is the authoritative run record (log lines can drop under file locks — do NOT tail -f the log, poll with wc -l).
- Repo at origin/main; prod URL https://hadley-bricks-inventory-management.vercel.app (route exists there too but is NOT scheduled anywhere on GCP — this watcher was born local; verify no GCP job targets it).

RULES: INDEPENDENT + ADVERSARIAL — re-derive everything with your own commands. READ-ONLY: no DB mutations, no task changes, no GCP changes. You MAY invoke the local runner (powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts/run-ebay-bin-partout.ps1") AT MOST ONCE outside quiet hours — one scan cycle, identical to the schedule. Report concrete evidence.`;

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'verdict', 'summary', 'evidence', 'issues'],
  properties: {
    dimension: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
    summary: { type: 'string' },
    evidence: { type: 'string' },
    issues: {
      type: 'array',
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
    prompt: `Confirm the feature is merged + deployed with no regression. (1) git fetch; origin/main contains the scanner service, route, both ps1 scripts, the migration file 20260702121815_ebay_bin_partout.sql, and the done-criteria doc. (2) Prod healthy (/ -> 200/307) and POST /api/cron/ebay-bin-partout on PROD with no auth -> 401 (route deployed + gated). (3) The pre-existing auction route still 401-gated (no regression). (4) Local server serves the route: POST localhost:3000/api/cron/ebay-bin-partout with no auth -> 401 (proves the LOCAL build includes the feature — if 404 the local rebuild was missed => FAIL).`,
  },
  {
    key: 'hitlist-integrity',
    prompt: `Independently verify ebay_bin_hitlist against its sources (WIDENED spec, PR #488). (1) Recompute the expected membership with your own SQL over bricklink_part_out_value_cache: every distinct set_number with a condition='U' NOT is_aggregate_listing row with sold_6mo_avg_gbp > 0 (LEFT JOIN the N-condition aggregate and brickset_sets on set_number||'-1' — no rrp/pov/ratio/year floors). Expected ~12,621; compare counts + spot-check 5 rows' used_pov_gbp (LEAST(used, coalesce(new, used))) and ratio (null when no rrp) against the cache. (2) EVERY row must satisfy used_pov_gbp <= new_pov_gbp when new_pov_gbp is not null (the cap invariant) — count violations. (3) refresh preserves learned columns: read the function source (pg_get_functiondef) and confirm ebay_floor_gbp/fig_share_pct are not overwritten in the ON CONFLICT update. (4) config row exists with min_ratio=0, min_used_pov_gbp=0, min_multiple=3, great_multiple=4, price_floor_pct=15. Verdict FAIL on membership drift >2%, any cap violation, or learned-column clobbering.`,
  },
  {
    key: 'scanner-code-correctness',
    prompt: `Adversarially review the scanner service at origin/main against the discovery findings + the dual-pass spec. Confirm: (1) TWO search passes per cycle (USED always; NEW gated by config.new_scan_enabled), each ONE search call (q='lego', category 19006, FIXED_PRICE + GB + price cap, newlyListed, limit 200) plus saturation pagination bounded at 3 pages (extra pages ONLY when a full page is entirely newer than the cursor, counted in saturatedPages), and getItem ONLY for candidates over a buy bar — estimate worst-case daily API spend at 96 cycles and confirm ~200-500/day, far under eBay's 5k. (2) Cursor semantics PER PASS (last_scan_cursor / last_scan_cursor_new): items with creation <= cursor skipped; UNDATED items skipped when a cursor exists (bootstrap-only processing — the E2E fix; comment and code must now agree); cursor advances to newest seen; both cursors written in one config update. (3) NEW-pass economics: Amazon margin via amazonResaleMargin (18.36% + £3/£4 shipping) from seeded_asin_pricing batch lookup (bare + '-1' key variants, single-set candidates only), signal at margin >= config bar AND profit > 0; New-POV signal from hitlist new_pov_gbp; tier great on either great-bar. (4) The flag set covers the discovery false-positive classes: Type aspect missing/!=Complete, pieces-vs-catalog ±2% lie detector, LEGO Character + <15% POV floor, title patterns (spares/incomplete/parts only/builds only/from set/no figs, PLUS sealed caveats open box/resealed/damaged box, PLUS the FIXED '\\d+%' branch — verify titleCaveat('99% complete') matches, it was dead code before), description-caveat backup, new-seller<10, and the young-set thin-used-history flag NOW INSIDE assembleFlags (USED pass only — verify the unit test asserting it does NOT fire for conditionMode 'new'). (5) Flag-don't-suppress: flags NEVER cause a candidate to be dropped. (6) ZERO BrickLink API imports/calls; ZERO Keepa. (7) eBay-floor learning only in the USED pass from plausible complete listings. List any real defect.`,
  },
  {
    key: 'task-and-runs',
    prompt: `Prove the 15-min local cadence is real and healthy. (1) schtasks: task exists, Enabled, repeats every 15 minutes, runs run-ebay-bin-partout.ps1. (2) job_execution_history (job_name='ebay-bin-partout'): rows at ~15-min spacing since registration, status completed (quiet-hour skips also complete). (3) logs/ebay-bin-partout-local.log has matching ok/skipped lines (poll with wc -l, never tail -f — file locks silently drop runner log lines). (4) If fewer than 2 scheduled runs have happened yet, you may invoke the runner ONCE and confirm an ok line with apiCalls>=1 and exit 0. Verdict FAIL if the task is missing/disabled or runs are erroring; WARN if registered but not yet ticked twice.`,
  },
  {
    key: 'alerts-and-cards',
    prompt: `Verify alert integrity + the Discord explicitness contract. (1) SQL: ebay_auction_alerts rows with listing_type='bin' must have pov_condition in ('used','new'); used rows need non-null pov_sold_gbp/pov_multiple and buy_signal containing 'part-out'; NEW rows may instead carry amazon_price_gbp/margin_percent with buy_signal containing 'Amazon' (POV fields null when no New-POV data); flags populated whenever the title/description contained caveat words. Rows with discord_sent=false are LEGITIMATE now (durability pre-save; only a FAIL if discord_sent=false persists on rows older than ~an hour while newer sends succeeded). Zero rows is fine (episodic). (2) CODE contract review — sendEbayBinPartoutAlert must lead with '▶️ The play' (used: part-out framing; new+Amazon: 'resell on Amazon' with Buy Box link + profit/margin, optional second-exit POV line; new POV-only: sealed part-out framing) then '👉 Do' (buy price + offer suggestion when Best Offer) then '⚠️' flags; title headline switches 🛒 BIN RESALE vs 🧩 BIN PART-OUT; sendEbayAuctionAlert must lead with play/do (ends-Xm + PART-OUT/RESALE title); the Vinted extension sendToDiscord must push play/do fields FIRST. (3) The route must saveAlert(discord_sent=false) BEFORE the Discord attempt and update to true after success. Verdict FAIL if any card lacks the play/do head, a malformed bin alert row exists, or the pre-save ordering is absent.`,
  },
  {
    key: 'guards-regression',
    prompt: `Confirm the new feature did not disturb this week's earlier shipments. (1) The 5-min auction sniper is still ticking: job_execution_history job_name='ebay-auction-sniper' rows at 5-min spacing over the last hour, completed. (2) GCP: ebay-auction-sniper job still PAUSED and NO GCP job targets /api/cron/ebay-bin-partout (gcloud scheduler jobs list --location=europe-west2 --project=gen-lang-client-0823893317). (3) The used-POV guards remain in the auction scanner (cap + thin-history in ebay-auction-scanner.service.ts at origin/main). (4) vinted_sniper_decisions still receiving rows with mode set (extension alive). Verdict FAIL on any regression.`,
  },
];

phase('Validate');
const findings = (
  await parallel(
    DIMENSIONS.map((d) => () =>
      agent(`${CTX}\n\nDIMENSION: ${d.key}\n${d.prompt}\n\nReturn your finding via the schema.`, {
        label: `validate:${d.key}`,
        phase: 'Validate',
        schema: FINDING_SCHEMA,
      })
    )
  )
).filter(Boolean);

phase('Verify');
const concerning = findings.filter((f) => f.verdict !== 'PASS');
const verifications = await parallel(
  concerning.map((f) => () =>
    agent(
      `${CTX}\n\nA validator reported dimension "${f.dimension}" as ${f.verdict}: ${f.summary}\nEvidence: ${f.evidence}\nClaimed issues: ${JSON.stringify(f.issues)}\n\nYou are the SKEPTIC. Independently re-derive this from LIVE systems with your own commands. Decide whether each claimed issue is a REAL defect or a false positive (e.g. zero alerts because deals are episodic, task registered but young, quiet-hours skips). Default to "real" only if you can reproduce it live.`,
      {
        label: `verify:${f.dimension}`,
        phase: 'Verify',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['dimension', 'confirmedReal', 'verdict', 'explanation'],
          properties: {
            dimension: { type: 'string' },
            confirmedReal: { type: 'boolean' },
            verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
            explanation: { type: 'string' },
          },
        },
      }
    )
  )
);

phase('Synthesize');
const report = await agent(
  `${CTX}\n\nSynthesize the FINAL E2E validation verdict for the eBay BIN part-out watcher.\n\nVALIDATOR FINDINGS:\n${JSON.stringify(findings, null, 2)}\n\nADVERSARIAL VERIFICATIONS (non-PASS dims only):\n${JSON.stringify(verifications, null, 2)}\n\nProduce: overall PASS / PASS-WITH-NOTES / FAIL; one-line per-dimension status; any CONFIRMED-REAL defects with severity + suggested action. HONESTY NOTES: (a) if no bin alert has fired yet, say the alert/card path is verified by code + unit tests only and recommend re-checking after the first live alert; (b) note the residual local-machine dependency and that alert flow is episodic (a few genuine deals/week expected); (c) the RRP denominator is a bootstrap — re-ranking by learned eBay floor is a v2 switch.`,
  { label: 'synthesize', phase: 'Synthesize' }
);

log('E2E validation complete.');
return { findings, verifications, report };
